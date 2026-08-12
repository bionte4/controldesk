import "server-only";

import * as React from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import type { ReportKind } from "./registry";
import type {
  ReportColumnAlign,
  ReportColumnFormat,
  ReportResult,
  ReportRow,
} from "./types";

/**
 * PDF serializer for `ReportResult`. Produces a landscape-A4 document
 * with a compact tabular layout inspired by SAP/ORACLE financial
 * exports — dense but still readable.
 *
 * Uses `@react-pdf/renderer`'s server-side `renderToBuffer` API. This
 * runs pure Node (no browser/headless-Chrome dependencies), which
 * keeps our Docker image slim.
 *
 * Layout:
 *   * Header band  — title, generated timestamp, scope summary.
 *   * Column header row — sticky-styled (dark background, white text).
 *   * Data rows — striped for readability.
 *   * Totals row — bold with a hairline top border.
 *   * Footer  — page X of Y, generated ISO string.
 *
 * Content-format handling:
 *   * money  → `Intl.NumberFormat("id-ID")` grouped, no decimals.
 *   * percent → 0.0%, one decimal place.
 *   * date   → yyyy-mm-dd (already stored as ISO strings; no
 *     timezone shifting needed for a monthly report).
 *   * status → uppercase, no formatting change.
 *   * text/number (default) → raw string / grouped integer.
 */
export async function serializeReportToPdf(
  result: ReportResult,
): Promise<Buffer> {
  return renderToBuffer(<ReportDocument result={result} />);
}

export function pdfFilename(kind: ReportKind, generatedAtIso: string): string {
  const ts = generatedAtIso.replace(/[:.]/g, "-").slice(0, 19);
  return `${kind}_${ts}.pdf`;
}

// ------------------------------------------------------------------
// styles
// ------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 24,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#0F172A", // slate-900
  },
  headerBand: {
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#CBD5E1", // slate-300
  },
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#1E293B", // slate-800
  },
  subMeta: {
    fontSize: 8,
    color: "#64748B", // slate-500
    marginTop: 3,
  },
  table: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
  },
  headerRow: {
    display: "flex",
    flexDirection: "row",
    backgroundColor: "#1E293B", // slate-800
    color: "#FFFFFF",
    minHeight: 18,
    paddingVertical: 5,
    paddingHorizontal: 3,
  },
  headerCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    paddingHorizontal: 3,
  },
  dataRow: {
    display: "flex",
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0", // slate-200
  },
  dataRowAlt: {
    backgroundColor: "#F8FAFC", // slate-50 — subtle zebra
  },
  cell: {
    fontSize: 8,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  totalsRow: {
    display: "flex",
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 3,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: "#334155", // slate-700
  },
  totalsCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    paddingHorizontal: 3,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 24,
    right: 24,
    fontSize: 7,
    color: "#64748B",
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pageNumber: {
    fontSize: 7,
    color: "#64748B",
  },
});

// ------------------------------------------------------------------
// document
// ------------------------------------------------------------------

function ReportDocument({ result }: { result: ReportResult }) {
  const generated = new Date(result.generatedAt).toISOString().slice(0, 19).replace("T", " ");
  const widths = computeColumnWidths(result);

  return (
    <Document
      title={result.title}
      author="ControlDesk"
      creator="ControlDesk Reports"
    >
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        {/* Header band — repeats on every page via `fixed` so the
           reader knows what they're looking at even mid-scroll. */}
        <View style={styles.headerBand} fixed>
          <Text style={styles.title}>{result.title}</Text>
          <Text style={styles.subMeta}>
            {result.scopeSummary} · Generated {generated} UTC
          </Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          {/* Column header — also `fixed` so it repeats on every
             page. Users hate scrolling a 20-page report only to lose
             the header on page 2. */}
          <View style={styles.headerRow} fixed>
            {result.columns.map((c, i) => (
              <Text
                key={`h-${c.key}`}
                style={{
                  ...styles.headerCell,
                  width: `${widths[i]}%`,
                  textAlign: alignFor(c.align),
                }}
              >
                {c.label}
              </Text>
            ))}
          </View>

          {/* Data rows */}
          {result.rows.map((row, r) => (
            <View
              key={`r-${r}`}
              style={
                r % 2 === 1
                  ? { ...styles.dataRow, ...styles.dataRowAlt }
                  : styles.dataRow
              }
              wrap={false}
            >
              {result.columns.map((c, i) => (
                <Text
                  key={`r-${r}-c-${c.key}`}
                  style={{
                    ...styles.cell,
                    width: `${widths[i]}%`,
                    textAlign: alignFor(c.align),
                  }}
                >
                  {formatCell(row[i], c.format)}
                </Text>
              ))}
            </View>
          ))}

          {/* Totals row */}
          {result.totals ? (
            <View style={styles.totalsRow} wrap={false}>
              {result.columns.map((c, i) => (
                <Text
                  key={`t-${c.key}`}
                  style={{
                    ...styles.totalsCell,
                    width: `${widths[i]}%`,
                    textAlign: alignFor(c.align),
                  }}
                >
                  {formatCell(result.totals?.[i], c.format)}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        {/* Footer with page number + generated timestamp. */}
        <View style={styles.footer} fixed>
          <Text>ControlDesk · {result.kind}</Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

function alignFor(align?: ReportColumnAlign): "left" | "right" | "center" {
  return align ?? "left";
}

const moneyFmt = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0,
});
const percentFmt = new Intl.NumberFormat("id-ID", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatCell(
  cell: ReportRow[number] | undefined,
  format: ReportColumnFormat | undefined,
): string {
  if (cell === null || cell === undefined) return "";
  switch (format) {
    case "money":
      if (typeof cell === "number") return moneyFmt.format(cell);
      return String(cell);
    case "number":
      if (typeof cell === "number") return moneyFmt.format(cell);
      return String(cell);
    case "percent":
      if (typeof cell === "number") return percentFmt.format(cell);
      return String(cell);
    case "date":
      if (typeof cell === "string" && cell.length >= 10) {
        return cell.slice(0, 10);
      }
      return String(cell);
    case "status":
      return String(cell).toUpperCase();
    default:
      return String(cell);
  }
}

/**
 * Column-width heuristic in percent (must total 100).
 *
 * Money/percent/date/status columns are given a fixed baseline width;
 * text columns share the leftover space proportionally to their label
 * length so a "Purpose" column doesn't get the same width as "Type".
 */
function computeColumnWidths(result: ReportResult): number[] {
  const totalCols = result.columns.length;
  const baselineByFormat: Record<string, number> = {
    money: 9,
    percent: 6,
    date: 7,
    status: 7,
    number: 6,
  };
  const widths = result.columns.map((c) => baselineByFormat[c.format ?? ""] ?? 0);
  const fixedTotal = widths.reduce((a, b) => a + b, 0);
  const remaining = Math.max(100 - fixedTotal, 20);

  // Distribute remaining % among unassigned (text) columns weighted
  // by their label length so long-label columns get more room.
  const textIndexes = widths
    .map((w, i) => ({ w, i }))
    .filter((x) => x.w === 0)
    .map((x) => x.i);

  const weights = textIndexes.map(
    (i) => Math.max(result.columns[i].label.length, 6),
  );
  const weightTotal = weights.reduce((a, b) => a + b, 0) || 1;
  textIndexes.forEach((i, idx) => {
    widths[i] = (weights[idx] / weightTotal) * remaining;
  });

  // Rebalance if all columns had fixed widths but totalled != 100 —
  // stretch them proportionally to fill the page.
  const finalTotal = widths.reduce((a, b) => a + b, 0);
  if (finalTotal > 0 && finalTotal !== 100) {
    for (let i = 0; i < totalCols; i += 1) {
      widths[i] = (widths[i] / finalTotal) * 100;
    }
  }
  return widths;
}
