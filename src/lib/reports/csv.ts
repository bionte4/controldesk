import "server-only";

import type { ReportResult, ReportRow } from "./types";

/**
 * Serialize a `ReportResult` to a CSV string per RFC 4180. Excel-safe
 * quoting rules: any cell containing `,`, `"`, `\r`, or `\n` gets
 * wrapped in double quotes with embedded quotes doubled.
 *
 * The output starts with a UTF-8 BOM (`\ufeff`) so Excel opens it in
 * the correct encoding for Indonesian tenants that rely on accented
 * client / vendor names.
 *
 * Layout:
 *   Row 1: report title
 *   Row 2: scope summary  (e.g. "Aug 1–31, 2026 · 3 projects")
 *   Row 3: generated at ISO
 *   Row 4: [blank]
 *   Row 5: column headers
 *   Row 6+: data rows
 *   Last:  totals (optional, prefixed with a blank line)
 */
export function serializeReportToCsv(result: ReportResult): string {
  const lines: string[] = [];

  lines.push(escapeCell(result.title));
  lines.push(escapeCell(result.scopeSummary));
  lines.push(escapeCell(`Generated: ${result.generatedAt}`));
  lines.push("");
  lines.push(result.columns.map((c) => escapeCell(c.label)).join(","));

  for (const row of result.rows) {
    lines.push(serializeRow(row));
  }

  if (result.totals) {
    lines.push("");
    lines.push(serializeRow(result.totals));
  }

  // Excel-friendly UTF-8 BOM so accented names (Ç, é, ü) render
  // correctly when the file is opened via double-click on Windows.
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

function serializeRow(row: ReportRow): string {
  return row
    .map((cell) => {
      if (cell === null || cell === undefined) return "";
      return escapeCell(String(cell));
    })
    .join(",");
}

function escapeCell(v: string): string {
  // Cells that contain reserved chars must be wrapped in quotes; embedded
  // quotes become doubled per RFC 4180.
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/**
 * Build a safe, human-readable filename for the export. Preserves the
 * report kind + generation date, sanitizes anything that could break a
 * `Content-Disposition` header on the browser side.
 */
export function reportFilename(
  kind: string,
  extension: "csv" | "xlsx" | "pdf",
  generatedAtIso: string,
): string {
  const stamp = generatedAtIso.replace(/[:.]/g, "-").replace(/T/, "_");
  const safeKind = kind.replace(/[^a-z0-9-]/gi, "_");
  return `${safeKind}_${stamp}.${extension}`;
}
