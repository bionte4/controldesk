import { describe, expect, it } from "vitest";

import { reportFilename, serializeReportToCsv } from "./csv";
import type { ReportResult } from "./types";

// Minimal fixture — one text col, one money col, one status col.
// Reused across shape / escaping / totals tests so the intent is
// explicit at each call site.
const fixture: ReportResult = {
  kind: "expense-register",
  title: "Expense Register",
  generatedAt: "2026-08-08T10:00:00.000Z",
  scopeSummary: "Aug 1–31, 2026 · 2 projects",
  columns: [
    { key: "vendor", label: "Vendor" },
    { key: "amount", label: "Amount", format: "money", align: "right" },
    { key: "status", label: "Status", format: "status" },
  ],
  rows: [
    ["Acme, Inc.", 1_250_000, "APPROVED"],
    ['PT "Sinar" Jaya', 750_000, "PENDING_L2"],
    ["Line\nbreak vendor", 42, "DRAFT"],
    ["Empty", null, "REJECTED"],
  ],
  totals: ["TOTAL", 2_000_042, null],
};

describe("serializeReportToCsv", () => {
  it("emits a UTF-8 BOM as the very first character", () => {
    const out = serializeReportToCsv(fixture);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  it("puts title / scope / generated / blank / headers in the first five lines", () => {
    const out = serializeReportToCsv(fixture).slice(1); // strip BOM
    const lines = out.split("\r\n");
    expect(lines[0]).toBe("Expense Register");
    // Scope summary contains a comma → correctly wrapped in quotes.
    expect(lines[1]).toBe('"Aug 1–31, 2026 · 2 projects"');
    expect(lines[2]).toBe("Generated: 2026-08-08T10:00:00.000Z");
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("Vendor,Amount,Status");
  });

  it("quotes cells containing commas per RFC 4180", () => {
    const out = serializeReportToCsv(fixture);
    expect(out).toContain(`"Acme, Inc.",1250000,APPROVED`);
  });

  it("doubles embedded double-quotes when quoting", () => {
    const out = serializeReportToCsv(fixture);
    expect(out).toContain(`"PT ""Sinar"" Jaya"`);
  });

  it("quotes cells that contain newlines so single-cell newlines don't break row parsing", () => {
    const out = serializeReportToCsv(fixture);
    expect(out).toContain(`"Line\nbreak vendor"`);
  });

  it("renders nullish cells as empty strings, not the word 'null'", () => {
    const out = serializeReportToCsv(fixture);
    // Row: Empty,,REJECTED — two commas back-to-back.
    expect(out).toMatch(/^Empty,,REJECTED$/m);
  });

  it("prefixes the totals row with a blank line so Excel visually separates it", () => {
    const out = serializeReportToCsv(fixture);
    // Two consecutive line separators = blank line before totals.
    expect(out).toMatch(/\r\n\r\nTOTAL,2000042,\r\n$/);
  });

  it("terminates the output with CRLF so trailing rows don't merge into next paste", () => {
    const out = serializeReportToCsv(fixture);
    expect(out.endsWith("\r\n")).toBe(true);
  });
});

describe("reportFilename", () => {
  it("keeps the kind slug intact and replaces colons in the ISO stamp", () => {
    const fn = reportFilename("expense-register", "csv", "2026-08-08T10:00:00.000Z");
    expect(fn).toBe("expense-register_2026-08-08_10-00-00-000Z.csv");
  });

  it("sanitizes non-alphanumeric kind characters to underscores", () => {
    // Guards against a future kind slug accidentally introducing a
    // `/` or `..` that browsers would treat weirdly in the download
    // bar. This test also prevents header-injection via kind.
    const fn = reportFilename("../etc/passwd", "pdf", "2026-01-01T00:00:00Z");
    expect(fn).not.toContain("/");
    expect(fn).not.toContain("..");
    expect(fn.endsWith(".pdf")).toBe(true);
  });
});
