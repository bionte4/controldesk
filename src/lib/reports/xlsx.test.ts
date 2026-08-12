import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import type { ReportResult } from "./types";
import { serializeReportToXlsx, xlsxFilename } from "./xlsx";

const fixture: ReportResult = {
  kind: "project-portfolio",
  title: "Project Portfolio",
  generatedAt: "2026-08-08T10:00:00.000Z",
  scopeSummary: "Last 90 days · 3 projects",
  columns: [
    { key: "code", label: "Code", nowrap: true },
    { key: "name", label: "Project" },
    { key: "planned", label: "Planned", format: "money", align: "right" },
    { key: "util", label: "Util. %", format: "percent", align: "right" },
    { key: "start", label: "Start", format: "date" },
    { key: "status", label: "Status", format: "status" },
  ],
  rows: [
    ["P-001", "Website revamp", 50_000_000, 0.62, "2026-05-10", "ACTIVE"],
    ["P-002", "Mobile v2", 120_000_000, 0.9, "2026-01-15", "PLANNING"],
  ],
  totals: ["TOTAL", null, 170_000_000, null, null, null],
};

/**
 * Read the workbook we just generated so we can assert on its
 * structure. Round-trip through `xlsx.load()` is the closest thing to
 * "does Excel accept this?" without shelling out to LibreOffice.
 */
async function roundTrip(result: ReportResult): Promise<ExcelJS.Workbook> {
  const buf = await serializeReportToXlsx(result);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

describe("serializeReportToXlsx", () => {
  it("creates a single worksheet named after the report title", async () => {
    const wb = await roundTrip(fixture);
    expect(wb.worksheets).toHaveLength(1);
    expect(wb.worksheets[0].name).toBe("Project Portfolio");
  });

  it("emits a header row with all column labels", async () => {
    const wb = await roundTrip(fixture);
    const ws = wb.worksheets[0];
    const headerRow = ws.getRow(1);
    const labels = fixture.columns.map((c) => c.label);
    for (let i = 0; i < labels.length; i += 1) {
      expect(headerRow.getCell(i + 1).value).toBe(labels[i]);
    }
  });

  it("stores money cells as native numbers so SUM/AVG still work in Excel", async () => {
    const wb = await roundTrip(fixture);
    const ws = wb.worksheets[0];
    // Row 2 is the first data row (row 1 = header).
    expect(ws.getRow(2).getCell(3).value).toBe(50_000_000);
    expect(ws.getRow(3).getCell(3).value).toBe(120_000_000);
  });

  it("converts ISO date strings into Excel Date objects", async () => {
    const wb = await roundTrip(fixture);
    const ws = wb.worksheets[0];
    const cell = ws.getRow(2).getCell(5);
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString().slice(0, 10)).toBe("2026-05-10");
  });

  it("applies IDR number format to money columns", async () => {
    const wb = await roundTrip(fixture);
    const ws = wb.worksheets[0];
    expect(ws.getRow(2).getCell(3).numFmt).toBe("#,##0;[Red](#,##0)");
  });

  it("applies percent format to percent columns", async () => {
    const wb = await roundTrip(fixture);
    const ws = wb.worksheets[0];
    expect(ws.getRow(2).getCell(4).numFmt).toBe("0.0%");
  });

  it("appends totals as a bold row when provided", async () => {
    const wb = await roundTrip(fixture);
    const ws = wb.worksheets[0];
    // 1 header + 2 data + 1 totals = row 4.
    const totalsRow = ws.getRow(4);
    expect(totalsRow.getCell(1).value).toBe("TOTAL");
    expect(totalsRow.getCell(3).value).toBe(170_000_000);
    const font = totalsRow.font;
    expect(font?.bold).toBe(true);
  });

  it("truncates sheet names that would exceed Excel's 31-char cap", async () => {
    const longTitle: ReportResult = {
      ...fixture,
      title: "A".repeat(50),
    };
    const wb = await roundTrip(longTitle);
    expect(wb.worksheets[0].name.length).toBeLessThanOrEqual(31);
  });

  it("strips forbidden characters (\\ / ? * [ ] :) from the sheet name", async () => {
    const bad: ReportResult = { ...fixture, title: "Bad/Sheet:Name?[1]" };
    const wb = await roundTrip(bad);
    const name = wb.worksheets[0].name;
    expect(name).not.toMatch(/[\/\\?*\[\]:]/);
  });
});

describe("xlsxFilename", () => {
  it("preserves the kind slug and appends a sanitized ISO stamp", () => {
    const fn = xlsxFilename("expense-register", "2026-08-08T10:00:00.000Z");
    expect(fn).toBe("expense-register_2026-08-08T10-00-00.xlsx");
  });
});
