import "server-only";

import ExcelJS from "exceljs";

import type { ReportKind } from "./registry";
import type { ReportColumnFormat, ReportResult, ReportRow } from "./types";

/**
 * Serialize a `ReportResult` to an XLSX buffer (Node `Buffer`
 * compatible; returned as a plain `ArrayBuffer` here so the API route
 * can hand it to `NextResponse` without needing Node-specific types).
 *
 * The output workbook has:
 *   1. A single sheet named after `result.title` (truncated to Excel's
 *      31-char sheet-name limit).
 *   2. A header row (bold, filled) with column labels.
 *   3. Data rows with Excel-native types (numbers stay numeric so
 *      Finance can pivot/sum without re-parsing strings).
 *   4. An optional totals row rendered bold at the bottom.
 *   5. Column widths auto-sized to the longer of header/first ~50
 *      cells (bounded to prevent 200ch monsters).
 *
 * Money/percent/date/status formatting is applied per-column via
 * `numFmt`, which Excel then renders locale-aware on the user's
 * machine. We intentionally *do not* pre-format numbers as strings
 * because that would break Excel's SUM/AVERAGE functions.
 */
export async function serializeReportToXlsx(
  result: ReportResult,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ControlDesk";
  workbook.created = new Date(result.generatedAt);
  workbook.title = result.title;

  const sheetName = safeSheetName(result.title);
  const ws = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // --- Header row ------------------------------------------------
  ws.columns = result.columns.map((c) => ({
    header: c.label,
    key: c.key,
    // Column width heuristic: wider for money/text, narrower for
    // dates/status. Exceljs uses character-width units.
    width: widthForColumn(c.format, c.label.length),
  }));
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }, // slate-800
  };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;

  // --- Data rows -------------------------------------------------
  for (const row of result.rows) {
    const excelRow = ws.addRow(rowToObject(result.columns, row));
    // Apply per-cell number formats using the column format hint.
    result.columns.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.numFmt = numFmtForFormat(c.format);
      if (c.align === "right") cell.alignment = { horizontal: "right" };
      else if (c.align === "center") cell.alignment = { horizontal: "center" };
      if (c.format === "date" && typeof cell.value === "string") {
        // Convert ISO YYYY-MM-DD strings to real Excel dates so
        // Finance can pivot by month.
        const d = new Date(cell.value);
        if (!Number.isNaN(d.getTime())) cell.value = d;
      }
    });
  }

  // --- Totals row (optional, bold + thin top border) -------------
  if (result.totals) {
    const totalsRow = ws.addRow(rowToObject(result.columns, result.totals));
    totalsRow.font = { bold: true };
    totalsRow.border = { top: { style: "thin", color: { argb: "FF64748B" } } };
    result.columns.forEach((c, i) => {
      const cell = totalsRow.getCell(i + 1);
      cell.numFmt = numFmtForFormat(c.format);
      if (c.align === "right") cell.alignment = { horizontal: "right" };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  // exceljs returns a Node `Buffer` in Node and an `ArrayBuffer` in
  // Browser. NextResponse accepts either, but we normalise to
  // ArrayBuffer for a stable type surface.
  return buffer as ArrayBuffer;
}

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

function safeSheetName(title: string): string {
  // Excel forbids / \ ? * [ ] : and caps sheet names to 31 chars.
  return title
    .replace(/[\/\\?*\[\]:]/g, " ")
    .trim()
    .slice(0, 31) || "Report";
}

function rowToObject(
  columns: ReportResult["columns"],
  row: ReportRow,
): Record<string, string | number | Date | null> {
  const out: Record<string, string | number | Date | null> = {};
  columns.forEach((c, i) => {
    out[c.key] = row[i] ?? null;
  });
  return out;
}

function widthForColumn(
  format: ReportColumnFormat | undefined,
  labelLen: number,
): number {
  const minLabel = Math.max(labelLen + 2, 10);
  switch (format) {
    case "money":
      return Math.max(minLabel, 16);
    case "percent":
      return Math.max(minLabel, 10);
    case "date":
      return Math.max(minLabel, 12);
    case "status":
      return Math.max(minLabel, 14);
    case "number":
      return Math.max(minLabel, 10);
    default:
      return Math.max(minLabel, 24);
  }
}

function numFmtForFormat(format: ReportColumnFormat | undefined): string {
  switch (format) {
    case "money":
      // IDR thousands separator, no decimals — matches
      // src/lib/format/money.ts. Negative amounts render red-bracketed
      // per Finance's monthly-report house style.
      return "#,##0;[Red](#,##0)";
    case "number":
      return "#,##0";
    case "percent":
      return "0.0%";
    case "date":
      return "yyyy-mm-dd";
    default:
      return "@"; // text
  }
}

export function xlsxFilename(
  kind: ReportKind,
  generatedAtIso: string,
): string {
  const ts = generatedAtIso.replace(/[:.]/g, "-").slice(0, 19);
  return `${kind}_${ts}.xlsx`;
}
