import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import {
  detectFormat,
  normalizeHeader,
  parseImportBuffer,
} from "./parsers";

describe("parsers/detectFormat", () => {
  it("picks csv from extension", () => {
    expect(detectFormat("emp.csv")).toBe("csv");
  });
  it("picks xlsx from extension", () => {
    expect(detectFormat("emp.xlsx")).toBe("xlsx");
  });
  it("picks xlsx from .xls", () => {
    expect(detectFormat("legacy.xls")).toBe("xlsx");
  });
  it("returns null for unknown", () => {
    expect(detectFormat("resume.pdf")).toBeNull();
  });
  it("falls back to mime when extension is opaque", () => {
    expect(detectFormat("blob", "text/csv")).toBe("csv");
  });
});

describe("parsers/normalizeHeader", () => {
  it("lowercases and underscores", () => {
    expect(normalizeHeader("First Name")).toBe("first_name");
    expect(normalizeHeader("Emergency Contact Name")).toBe(
      "emergency_contact_name",
    );
  });
  it("strips non-alnum-underscore chars", () => {
    expect(normalizeHeader("Client (name or contract#)")).toBe(
      "client_name_or_contract",
    );
  });
});

describe("parsers/parseImportBuffer (CSV)", () => {
  const csvBuffer = (s: string) => Buffer.from(s, "utf-8");

  it("parses a simple CSV with BOM and quoted values", async () => {
    const csv = "\uFEFFfirstname,lastname,notes\r\nJohn,\"Doe, Jr.\",\"line1\nline2\"\r\n";
    const parsed = await parseImportBuffer({
      buffer: csvBuffer(csv),
      filename: "emp.csv",
    });
    expect(parsed.format).toBe("csv");
    expect(parsed.headers).toEqual(["firstname", "lastname", "notes"]);
    expect(parsed.rows).toEqual([
      {
        firstname: "John",
        lastname: "Doe, Jr.",
        notes: "line1\nline2",
      },
    ]);
  });

  it("skips empty rows", async () => {
    const csv = "code,name\r\nA,foo\r\n\r\nB,bar\r\n";
    const parsed = await parseImportBuffer({
      buffer: csvBuffer(csv),
      filename: "x.csv",
    });
    expect(parsed.rows).toHaveLength(2);
  });

  it("rejects file over 500 rows", async () => {
    const rows = Array.from({ length: 502 })
      .map((_, i) => `E-${i}`)
      .join("\r\n");
    const csv = `code\r\n${rows}\r\n`;
    await expect(
      parseImportBuffer({ buffer: csvBuffer(csv), filename: "big.csv" }),
    ).rejects.toThrow(/500/);
  });

  it("rejects unknown file type", async () => {
    await expect(
      parseImportBuffer({ buffer: Buffer.from("x"), filename: "x.pdf" }),
    ).rejects.toThrow(/Unsupported/);
  });
});

describe("parsers/parseImportBuffer (XLSX)", () => {
  async function buildXlsx(headers: string[], rows: unknown[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("sheet1");
    ws.addRow(headers);
    for (const r of rows) ws.addRow(r);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
    return Buffer.from(buf);
  }

  it("parses headers + rows and normalises them", async () => {
    const buf = await buildXlsx(
      ["First Name", "Last Name", "Join Date"],
      [
        ["John", "Doe", new Date(Date.UTC(2026, 0, 15))],
        ["Jane", "Roe", new Date(Date.UTC(2026, 5, 1))],
      ],
    );
    const parsed = await parseImportBuffer({ buffer: buf, filename: "emp.xlsx" });
    expect(parsed.headers).toEqual(["first_name", "last_name", "join_date"]);
    expect(parsed.rows[0]).toEqual({
      first_name: "John",
      last_name: "Doe",
      join_date: "2026-01-15",
    });
  });
});
