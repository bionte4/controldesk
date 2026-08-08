import { NextResponse } from "next/server";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { reportFilename, serializeReportToCsv } from "@/lib/reports/csv";
import { pdfFilename, serializeReportToPdf } from "@/lib/reports/pdf";
import { isValidReportKind } from "@/lib/reports/registry";
import { runReport } from "@/lib/reports/runner";
import { serializeReportToXlsx, xlsxFilename } from "@/lib/reports/xlsx";
import { limit, RateLimitPresets } from "@/lib/security/rate-limit";

/**
 * GET /api/reports/[kind]?format=csv&from=YYYY-MM-DD&to=YYYY-MM-DD&
 *   projectId=<uuid>&projectId=<uuid>&expenseStatus=APPROVED&
 *   caStatus=DISBURSED&brKind=INCREASE&fundId=<uuid>&fiscalYear=2026
 *
 * Streams the report as a downloadable file. Auth + PDP + audit run
 * inside `runReport()`; this handler focuses on filter parsing,
 * per-user rate limiting, and MIME/`Content-Disposition` plumbing.
 *
 * Rate limits are keyed per-user (not per-IP) so that a curious ops
 * person doesn't accidentally DoS the export pipeline for their
 * office. Redis-backed when available; in-process fallback otherwise.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  if (!isValidReportKind(kind)) {
    return NextResponse.json({ error: "Unknown report kind." }, { status: 404 });
  }

  // Rate-limit per user before any query runs so an abusive caller
  // can't cause 20 successive Postgres round-trips just to bounce
  // off the limiter later. `requireCurrentEmployee()` throws when
  // unauthenticated; we translate that to a 401 for the API surface
  // rather than the RSC redirect it normally triggers.
  let employeeId: string;
  let tenantId: string;
  try {
    const employee = await requireCurrentEmployee();
    employeeId = employee.id;
    tenantId = employee.tenant_id;
  } catch {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const rl = await limit(
    `report:${tenantId}:${employeeId}`,
    RateLimitPresets.reportExport(),
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many report exports — try again in ${Math.max(
          1,
          rl.resetAt - Math.floor(Date.now() / 1000),
        )}s.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000)),
          ),
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.resetAt),
        },
      },
    );
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();

  const filters = {
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    projectIds: url.searchParams.getAll("projectId"),
    fiscalYear: parseIntOrNull(url.searchParams.get("fiscalYear")),
    fundId: url.searchParams.get("fundId"),
    expenseStatus: url.searchParams.get("expenseStatus"),
    caStatus: url.searchParams.get("caStatus"),
    brKind: castBrKind(url.searchParams.get("brKind")),
  };

  try {
    if (format === "csv") {
      const result = await runReport(kind, filters, "csv");
      const body = serializeReportToCsv(result);
      const filename = reportFilename(kind, "csv", result.generatedAt);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "xlsx") {
      const result = await runReport(kind, filters, "xlsx");
      const body = await serializeReportToXlsx(result);
      const filename = xlsxFilename(kind, result.generatedAt);
      return new NextResponse(body as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "pdf") {
      const result = await runReport(kind, filters, "pdf");
      const body = await serializeReportToPdf(result);
      const filename = pdfFilename(kind, result.generatedAt);
      return new NextResponse(body as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(
      { error: `Unsupported format: ${format}` },
      { status: 400 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Report generation failed.";
    // Surface auth denials as 403 vs a general 500 so the caller can
    // render the right toast.
    const isDenied = /access denied|not available/i.test(msg);
    return NextResponse.json(
      { error: msg },
      { status: isDenied ? 403 : 500 },
    );
  }
}

function parseIntOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function castBrKind(
  v: string | null,
): "INCREASE" | "DECREASE" | "TRANSFER" | null {
  if (v === "INCREASE" || v === "DECREASE" || v === "TRANSFER") return v;
  return null;
}
