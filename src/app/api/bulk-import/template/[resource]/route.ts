import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { getImportAdapter } from "@/lib/import/adapters";
import { isImportResource } from "@/lib/import/types";
import { authorize } from "@/lib/security/pdp";

/**
 * GET /api/bulk-import/template/[resource]?format=xlsx|csv
 *
 * Generates an empty starter file (single sheet) with:
 *   1. Header row of column labels (Column keys, not display labels,
 *      so the file round-trips cleanly through our parsers).
 *   2. Example row for user reference (styled as comment/example).
 *   3. Empty second data row to prompt the user.
 *
 * XLSX adds data validation (enum picklists, date format) where the
 * column definitions allow it — cuts down validation errors before
 * the file even reaches the server.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ resource: string }> },
) {
  const employee = await requireCurrentEmployee();
  const { resource: resourceParam } = await ctx.params;

  if (!isImportResource(resourceParam)) {
    return NextResponse.json(
      { error: "Unknown resource." },
      { status: 400 },
    );
  }

  const authz = authorize({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: employee.role as unknown as Parameters<
        typeof authorize
      >[0]["actor"]["role"],
      tenantId: employee.tenant_id,
    },
    action: "bulk_import",
    resource: "import_job",
    attributes: { tenantId: employee.tenant_id },
  });
  if (authz.effect === "DENY") {
    return NextResponse.json({ error: authz.reason }, { status: 403 });
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
  const adapter = getImportAdapter(resourceParam);

  if (format === "csv") {
    const csv = buildCsvTemplate(adapter.columns);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${resourceParam.toLowerCase()}_template.csv"`,
      },
    });
  }

  const workbook = await buildXlsxTemplate(
    resourceParam,
    adapter.columns,
  );
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${resourceParam.toLowerCase()}_template.xlsx"`,
    },
  });
}

// ---------------------------------------------------------------------------
// CSV template builder — UTF-8 BOM + RFC 4180 quoting.
// ---------------------------------------------------------------------------
function buildCsvTemplate(
  columns: Awaited<
    ReturnType<typeof getImportAdapter>
  >["columns"],
): string {
  const q = (s: string) => {
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const bom = "\uFEFF";
  const header = columns.map((c) => q(c.key)).join(",");
  const example = columns.map((c) => q(c.example)).join(",");
  const empty = columns.map(() => "").join(",");
  return bom + [header, example, empty].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// XLSX template builder — header row + example row + optional enum
// validation. Excel data-validation dropdowns cut a huge amount of
// user error.
// ---------------------------------------------------------------------------
async function buildXlsxTemplate(
  resource: string,
  columns: Awaited<
    ReturnType<typeof getImportAdapter>
  >["columns"],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ControlDesk";
  wb.created = new Date();
  const ws = wb.addWorksheet(resource.toLowerCase());

  // Column definitions — key = snake_case column key. Width = max
  // (header key length, example length) + padding.
  ws.columns = columns.map((c) => ({
    header: c.key,
    key: c.key,
    width: Math.max(c.key.length, c.example.length, 12) + 4,
  }));

  // Style the header row (row 1).
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEDE9FE" }, // Indigo-100
    };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });

  // Example row (row 2) — greyed out so users know to overwrite it.
  const example = ws.addRow(
    Object.fromEntries(columns.map((c) => [c.key, c.example])),
  );
  example.eachCell((cell) => {
    cell.font = { color: { argb: "FF94A3B8" }, italic: true };
  });

  // Add an empty starter row.
  ws.addRow({});

  // Enum data-validations on the appropriate columns.
  columns.forEach((c, idx) => {
    if (c.type === "enum" && c.enumValues?.length) {
      const colLetter = ws.getColumn(idx + 1).letter;
      // Apply to rows 2..500 (user's expected data range).
      for (let r = 2; r <= 501; r++) {
        ws.getCell(`${colLetter}${r}`).dataValidation = {
          type: "list",
          allowBlank: !c.required,
          formulae: [`"${c.enumValues.join(",")}"`],
        };
      }
    }
    if (c.type === "date") {
      const colLetter = ws.getColumn(idx + 1).letter;
      for (let r = 2; r <= 501; r++) {
        ws.getCell(`${colLetter}${r}`).numFmt = "yyyy-mm-dd";
      }
    }
    if (c.type === "money" || c.type === "number") {
      const colLetter = ws.getColumn(idx + 1).letter;
      for (let r = 2; r <= 501; r++) {
        ws.getCell(`${colLetter}${r}`).numFmt = "#,##0";
      }
    }
  });

  // Freeze the header row.
  ws.views = [{ state: "frozen", ySplit: 1 }];

  return wb;
}
