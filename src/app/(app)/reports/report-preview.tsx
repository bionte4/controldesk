"use client";

import * as React from "react";
import { format } from "date-fns";

import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/format/money";
import type { ReportResult } from "@/lib/reports/types";

/**
 * Render a `ReportResult` as an accessible HTML table with sticky
 * header, right-aligned money columns, and a distinctive totals row.
 * Kept lightweight — no virtualization; if a report exceeds ~5000
 * rows we should ship the CSV instead (rate-limit + audit already
 * covers that pattern).
 */
export function ReportPreview({ result }: { result: ReportResult }) {
  const rowCount = result.rows.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {rowCount} row{rowCount === 1 ? "" : "s"} · {result.scopeSummary}
        </span>
        <span>
          Generated {format(new Date(result.generatedAt), "PPpp")}
        </span>
      </div>
      {/*
        Layout notes:
          * `overflow-x-auto` keeps very wide reports scrollable
            without pushing the whole page wider.
          * We deliberately DO NOT set `min-width` on individual `<th>`
            elements — that forces horizontal overflow even when the
            content would happily wrap. Instead the browser auto-fits
            columns, and per-cell whitespace rules (see
            `cellClassFor()`) keep short data (dates, money, status)
            from wrapping while long descriptive text is allowed to
            break onto multiple lines.
      */}
      <div className="relative max-h-[540px] overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{result.title}</caption>
          <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
            <tr>
              {result.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-3 py-2 text-left font-medium text-xs uppercase tracking-wide whitespace-nowrap",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowCount === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-muted-foreground"
                  colSpan={result.columns.length}
                >
                  No rows match the selected filters.
                </td>
              </tr>
            ) : (
              result.rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-t border-border/60 hover:bg-muted/30"
                >
                  {row.map((cell, j) => {
                    const col = result.columns[j];
                    return (
                      <td
                        key={j}
                        className={cellClassFor(
                          col?.format,
                          col?.align,
                          col?.nowrap,
                        )}
                      >
                        {renderCell(cell, col?.format)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {result.totals ? (
            <tfoot className="sticky bottom-0 z-10 bg-muted/70 backdrop-blur">
              <tr className="border-t-2 border-border font-medium">
                {result.totals.map((cell, j) => {
                  const col = result.columns[j];
                  return (
                    <td
                      key={j}
                      className={cellClassFor(
                        col?.format,
                        col?.align,
                        col?.nowrap,
                      )}
                    >
                      {renderCell(cell, col?.format)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function renderCell(
  cell: string | number | null,
  format?: string,
): React.ReactNode {
  if (cell === null || cell === undefined || cell === "") return "—";
  if (format === "money" && typeof cell === "number") {
    return formatIDR(cell, { withSymbol: false });
  }
  if (format === "percent" && typeof cell === "number") {
    return `${cell.toFixed(1)}%`;
  }
  return String(cell);
}

/**
 * Per-cell layout — narrow-value columns (date, money, percent,
 * status) never wrap so they read as tabular numbers. Text columns
 * wrap freely with `break-words` to keep the overall table width
 * bounded to the container. Right-aligned columns get `tabular-nums`
 * so digits align vertically for quick eyeballing. An explicit
 * `nowrap` opt-in covers short opaque strings (project codes, IDs)
 * that shouldn't be line-broken even though their format is "text".
 */
function cellClassFor(
  format?: string,
  align?: string,
  nowrap?: boolean,
): string {
  const base = "px-3 py-2 align-top";
  const impliedNowrap =
    format === "money" ||
    format === "percent" ||
    format === "date" ||
    format === "status" ||
    format === "number";
  return cn(
    base,
    impliedNowrap || nowrap
      ? "whitespace-nowrap"
      : "whitespace-normal break-words",
    align === "right" && "text-right tabular-nums",
    align === "center" && "text-center",
    format === "status" && "text-xs uppercase tracking-wide",
  );
}
