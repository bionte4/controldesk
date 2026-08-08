import { describe, expect, it } from "vitest";

import { pdfFilename, serializeReportToPdf } from "./pdf";
import type { ReportResult } from "./types";

const fixture: ReportResult = {
  kind: "cash-advance-register",
  title: "Cash Advance Register",
  generatedAt: "2026-08-08T10:00:00.000Z",
  scopeSummary: "Aug 1–31, 2026 · 5 advances",
  columns: [
    { key: "type", label: "Type", format: "status" },
    { key: "requester", label: "Requester" },
    { key: "amount", label: "Amount", format: "money", align: "right" },
    { key: "status", label: "Status", format: "status" },
  ],
  rows: [
    ["GENERAL", "Alice", 500_000, "DISBURSED"],
    ["FIELD_OPS", "Bob", 1_500_000, "PENDING_FINANCE"],
  ],
  totals: ["TOTAL", null, 2_000_000, null],
};

describe("serializeReportToPdf", () => {
  // React-PDF's server renderer relies on Node stream APIs — we can't
  // meaningfully diff against a reference PDF (font subsetting varies
  // per host). Instead we assert on invariants that MUST hold: it
  // returns a Buffer, starts with the PDF magic bytes, and is
  // non-trivially sized. This catches "silently emits empty PDF"
  // regressions without being brittle.
  it("returns a Buffer that begins with the %PDF magic marker", async () => {
    const buf = await serializeReportToPdf(fixture);
    expect(Buffer.isBuffer(buf)).toBe(true);
    // First 4 bytes should be "%PDF" per ISO 32000.
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  }, 30_000);

  it("produces a non-trivial byte size (> 1 KB)", async () => {
    const buf = await serializeReportToPdf(fixture);
    // Even a bare-bones single-page PDF weighs a few KB thanks to
    // Helvetica font tables. Anything under 1 KB indicates a broken
    // render pipeline.
    expect(buf.length).toBeGreaterThan(1_000);
  }, 30_000);

  it("survives a report with zero data rows", async () => {
    const empty: ReportResult = { ...fixture, rows: [], totals: undefined };
    const buf = await serializeReportToPdf(empty);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  }, 30_000);
});

describe("pdfFilename", () => {
  it("preserves the kind slug and adds a sanitized ISO timestamp", () => {
    const fn = pdfFilename("cash-advance-register", "2026-08-08T10:00:00.000Z");
    expect(fn).toBe("cash-advance-register_2026-08-08T10-00-00.pdf");
  });
});
