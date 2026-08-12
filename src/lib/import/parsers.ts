import "server-only";

import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";

import { IMPORT_LIMITS } from "./limits";

/**
 * Shared parser layer for bulk imports.
 *
 * Contract:
 *   - Input: `Buffer` (server-uploaded file) + `mime` hint.
 *   - Output: `{ headers: string[], rows: RawRow[] }` where each row is
 *     a `Record<string, string>` mapping header → cell (all trimmed,
 *     empty cells removed from the object entirely).
 *
 * Design decisions:
 *   1. CSV parsed via `csv-parse/sync` — RFC 4180 compliant, handles
 *      quoted commas, embedded newlines, UTF-8 BOM.
 *   2. XLSX parsed via `exceljs` (already in deps). First row = headers.
 *      Only the first sheet is read; extra sheets ignored.
 *   3. Values normalised to string. Excel dates get an ISO conversion
 *      (`yyyy-mm-dd`) so downstream Zod parsers see the same shape as
 *      CSV.
 *   4. Header names are lowercased + underscored ("First Name" →
 *      "first_name", "Emergency Contact Name" → "emergency_contact_name").
 *      Templates use nice titles; column definitions use snake_case.
 */

export type RawRow = Record<string, string>;

export type ParseResult = {
  headers: string[];
  rows: RawRow[];
  /** Best-effort row count independent of `rows.length` — includes empty rows we skipped. */
  rawRowCount: number;
};

// Re-export IMPORT_LIMITS for backwards compatibility with server-side
// callers that already reference it via `parsers.ts`. Client components
// should import it directly from `./limits` (no server-only sentinel).
export { IMPORT_LIMITS };

const MAX_ROWS_HARD_CAP = IMPORT_LIMITS.maxRowsHardCap;
const MAX_FILE_BYTES = IMPORT_LIMITS.maxFileBytes;

export type ImportFileFormat = "csv" | "xlsx";

export function detectFormat(
  filename: string,
  mime?: string,
): ImportFileFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || mime === "text/csv") return "csv";
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  return null;
}

export function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function isEmptyCell(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // Format as YYYY-MM-DD (assumes date-only cell). Excel stores time
    // components too; we drop them for import unless the cell is
    // clearly a datetime (has non-zero H/M/S).
    const yyyy = v.getUTCFullYear();
    const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(v.getUTCDate()).padStart(2, "0");
    const h = v.getUTCHours();
    const m = v.getUTCMinutes();
    const s = v.getUTCSeconds();
    if (h || m || s) {
      // Full ISO
      return v.toISOString();
    }
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof v === "number") {
    // exceljs returns numbers unchanged; toString preserves precision
    // for phone numbers etc. If Excel formatted the cell as "phone",
    // exceljs already returned it as string.
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    // exceljs may return rich-text objects: { richText: [...] }
    // fall back to serialising known shapes.
    const r = v as { text?: unknown; richText?: Array<{ text: unknown }> };
    if (typeof r.text === "string") return r.text;
    if (Array.isArray(r.richText)) {
      return r.richText.map((rt) => String(rt.text ?? "")).join("");
    }
    return "";
  }
  return String(v).trim();
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function parseCsvBuffer(buffer: Buffer): ParseResult {
  // csv-parse handles UTF-8 BOM natively.
  const rowsRaw: unknown[][] = parseCsv(buffer, {
    trim: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    max_record_size: 128 * 1024,
  });

  if (rowsRaw.length === 0) {
    return { headers: [], rows: [], rawRowCount: 0 };
  }

  const rawHeaders = rowsRaw[0]!.map((h) => stringifyCell(h));
  const headers = rawHeaders.map(normalizeHeader);
  const rows: RawRow[] = [];
  for (let i = 1; i < rowsRaw.length; i++) {
    if (rows.length >= MAX_ROWS_HARD_CAP) break;
    const row = rowsRaw[i] ?? [];
    const obj: RawRow = {};
    let hasAny = false;
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue;
      const cell = stringifyCell(row[j]);
      if (!isEmptyCell(cell)) {
        obj[key] = cell;
        hasAny = true;
      }
    }
    if (hasAny) rows.push(obj);
  }

  return { headers, rows, rawRowCount: rowsRaw.length - 1 };
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------
async function parseXlsxBuffer(buffer: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  // exceljs' bundled `.d.ts` uses an older `Buffer` (from an outdated
  // @types/node) that clashes with the current `Buffer<ArrayBufferLike>`.
  // Casting the `Buffer` through `ArrayBuffer` mirrors the pattern used
  // in `src/lib/reports/xlsx.test.ts` for the same reason.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { headers: [], rows: [], rawRowCount: 0 };
  }

  const headerRow = worksheet.getRow(1);
  const rawHeaders: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    rawHeaders.push(stringifyCell(cell.value));
  });
  const headers = rawHeaders.map(normalizeHeader);

  const rows: RawRow[] = [];
  let rawRowCount = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // headers
    if (rows.length >= MAX_ROWS_HARD_CAP) return;
    rawRowCount++;
    const obj: RawRow = {};
    let hasAny = false;
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue;
      // exceljs is 1-indexed on getCell
      const cell = row.getCell(j + 1);
      const val = stringifyCell(cell.value);
      if (!isEmptyCell(val)) {
        obj[key] = val;
        hasAny = true;
      }
    }
    if (hasAny) rows.push(obj);
  });

  return { headers, rows, rawRowCount };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export async function parseImportBuffer(input: {
  buffer: Buffer;
  filename: string;
  mime?: string;
}): Promise<ParseResult & { format: ImportFileFormat }> {
  if (input.buffer.byteLength > MAX_FILE_BYTES) {
    throw new BulkImportParseError(
      `File is ${(input.buffer.byteLength / 1024 / 1024).toFixed(2)} MB — max ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }
  const format = detectFormat(input.filename, input.mime);
  if (!format) {
    throw new BulkImportParseError(
      "Unsupported file type. Upload .csv, .xlsx, or .xls.",
    );
  }
  const parsed =
    format === "csv"
      ? parseCsvBuffer(input.buffer)
      : await parseXlsxBuffer(input.buffer);

  if (parsed.rows.length > IMPORT_LIMITS.maxRowsPerFile) {
    throw new BulkImportParseError(
      `File has ${parsed.rows.length} data rows — max ${IMPORT_LIMITS.maxRowsPerFile}. Split the file and retry.`,
    );
  }
  return { ...parsed, format };
}

export class BulkImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkImportParseError";
  }
}
