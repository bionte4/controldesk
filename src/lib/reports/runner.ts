import "server-only";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { authorize } from "@/lib/security/pdp";
import { recordAudit } from "@/lib/security/audit";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { REPORT_REGISTRY, type ReportKind } from "./registry";
import type { ReportBaseFilters, ReportResult } from "./types";

/**
 * All report kinds share the same dispatch surface: they receive a
 * `ReportBaseFilters` payload and return a `ReportResult`. The runner
 * enforces auth + role gate, then defers to the per-kind query
 * implementation.
 *
 * Query modules register themselves in `QUERY_MAP` below. Keeping the
 * dispatch table centralized lets us fail at TypeScript compile time
 * when a new `ReportKind` is added to the registry but the query
 * function is missing.
 */

// Lazy imports so the runner file itself stays small — each query
// module pulls its own Supabase client + heavy typed selects on
// demand, keeping cold-start for the /reports index page snappy.
const QUERY_MAP: Record<
  ReportKind,
  (filters: ReportBaseFilters) => Promise<ReportResult>
> = {
  "project-portfolio": (f) =>
    import("./queries/project-portfolio").then((m) => m.runProjectPortfolio(f)),
  "expense-register": (f) =>
    import("./queries/expense-register").then((m) => m.runExpenseRegister(f)),
  "cash-advance-register": (f) =>
    import("./queries/cash-advance-register").then((m) =>
      m.runCashAdvanceRegister(f),
    ),
  "petty-cash-statement": (f) =>
    import("./queries/petty-cash-statement").then((m) =>
      m.runPettyCashStatement(f),
    ),
  "budget-vs-actual": (f) =>
    import("./queries/budget-vs-actual").then((m) => m.runBudgetVsActual(f)),
  "budget-request-register": (f) =>
    import("./queries/budget-request-register").then((m) =>
      m.runBudgetRequestRegister(f),
    ),
};

/**
 * Run a report end-to-end: PDP + role-visibility check + query
 * dispatch + audit trail. Callers are the RSC preview page and the
 * download API route.
 *
 * `output` is captured in the audit trail so we can distinguish an
 * on-screen preview from an actual export — regulators care about the
 * latter far more than the former.
 */
export async function runReport(
  kind: ReportKind,
  filters: Omit<ReportBaseFilters, "tenantId">,
  output: "preview" | "csv" | "xlsx" | "pdf",
): Promise<ReportResult> {
  const employee = await requireCurrentEmployee();
  const meta = REPORT_REGISTRY[kind];
  // `employees.role` is `AnyDbEmployeeRole` — cast to the canonical
  // `EmployeeRole` union because the report registry + PDP both key
  // off the DB names (rules §6 legacy aliasing is handled inside the
  // PDP; we don't need `toCanonicalRole` here).
  const dbRole = employee.role as EmployeeRole;

  // Coarse gate — may this role run *any* report?
  const decision = authorize({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: dbRole,
      tenantId: employee.tenant_id,
    },
    action: "read",
    resource: "report",
    attributes: { tenantId: employee.tenant_id },
  });
  if (decision.effect !== "ALLOW") {
    throw new Error(`Report access denied: ${decision.reason}`);
  }

  // Fine gate — the specific report kind. Prevents an OM from URL-
  // hitting `/reports/petty-cash-statement` when the card is hidden
  // from their nav (defense in depth against tab-share leaks).
  if (!meta.allowedRoles.includes(dbRole)) {
    throw new Error(
      `Report "${kind}" is not available to role ${employee.role}.`,
    );
  }

  const run = QUERY_MAP[kind];
  const result = await run({ ...filters, tenantId: employee.tenant_id });

  // Audit every report access. `EXPORT` covers both preview and
  // download — the metadata payload distinguishes them. Preview is
  // logged because it still enumerates rows the user could screenshot.
  await recordAudit({
    actionType: "EXPORT",
    resourceName: `report:${kind}`,
    resourceId: null,
    metadata: {
      output,
      filters: {
        from: filters.from ?? null,
        to: filters.to ?? null,
        projectIds: filters.projectIds ?? null,
        fiscalYear: filters.fiscalYear ?? null,
        fundId: filters.fundId ?? null,
        expenseStatus: filters.expenseStatus ?? null,
        caStatus: filters.caStatus ?? null,
        brKind: filters.brKind ?? null,
      },
      rowCount: result.rows.length,
    },
  });

  return result;
}
