import "server-only";

import type { ReportKind } from "./registry";

/**
 * Wire-format for every generated report. Kept intentionally
 * primitive: columns describe the header (labels + optional number
 * formatting hints), rows are plain string/number/null tuples aligned
 * to `columns` order.
 *
 * All Preview / CSV / XLSX / PDF renderers consume this contract, so
 * per-report query functions never need to know which output format
 * will be rendered. If a query wants to expose a raw money value it
 * returns a number; the CSV/XLSX serializer formats it. If a query
 * wants to expose an already-formatted "IDR 1.234.567" string it
 * returns a string. Either is fine — renderers switch on `align` and
 * `format` hints for right-align / thousands separators / etc.
 */
export type ReportColumnAlign = "left" | "right" | "center";
export type ReportColumnFormat =
  | "text"
  | "money"
  | "number"
  | "percent"
  | "date"
  | "status";

export type ReportColumn = {
  key: string;
  label: string;
  align?: ReportColumnAlign;
  format?: ReportColumnFormat;
  /** Truthy width hint in "ch" units — for Preview table column sizing.
   *  Deprecated in favor of `nowrap` for most cases; kept for future
   *  PDF layout hints where fixed widths matter more. */
  widthCh?: number;
  /**
   * When true, the preview cell keeps its content on a single line
   * (`whitespace-nowrap`). Use for short opaque strings — project
   * codes, IDs, CoA numbers — where line-wrapping would create ugly
   * 3-row tall rows. `date`, `money`, `percent`, `status`, and
   * `number` formats already imply nowrap automatically.
   */
  nowrap?: boolean;
};

export type ReportRow = ReadonlyArray<string | number | null>;

export type ReportResult = {
  kind: ReportKind;
  /** Human-readable title, already localized. Used in exports as file
   *  header and PDF title. */
  title: string;
  /** ISO 8601 timestamp when this report was generated. */
  generatedAt: string;
  /** Descriptive filter summary shown in the preview + exports header
   *  (e.g. "Aug 1 2026 – Aug 31 2026 · 3 projects"). */
  scopeSummary: string;
  columns: ReadonlyArray<ReportColumn>;
  rows: ReadonlyArray<ReportRow>;
  /**
   * Optional grand-totals row rendered visually distinct in preview
   * and appended as a footer in CSV/XLSX. Aligned to `columns` order —
   * cells that don't participate in a total must be `null`.
   */
  totals?: ReportRow;
};

/**
 * Common filter payload shared by all report queries. Individual
 * queries may accept extra typed params via a discriminated union in
 * their own module; this is the intersection every query understands.
 */
export type ReportBaseFilters = {
  tenantId: string;
  /** ISO date `YYYY-MM-DD`, inclusive. Optional when a report only
   *  keys off `fiscalYear`. */
  from?: string | null;
  /** ISO date `YYYY-MM-DD`, inclusive. */
  to?: string | null;
  projectIds?: string[] | null;
  fiscalYear?: number | null;
  fundId?: string | null;
  expenseStatus?: string | null;
  caStatus?: string | null;
  brKind?: "INCREASE" | "DECREASE" | "TRANSFER" | null;
};
