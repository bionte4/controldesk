import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { FinanceStatusBadge } from "@/components/finance/finance-status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { businessDaysUntil } from "@/lib/format/business-days";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadFieldOpsFormLookups } from "@/lib/data/lookups";
import { loadAllowedUnitsForProjects } from "@/lib/data/project-allowed-units";
import {
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import {
  buildApproverOrSelfClause,
  isApproverRole,
  resolveProjectScope,
} from "@/lib/security/project-scope";
import { CA_STATUS_LABEL, CA_STATUS_TONE } from "@/lib/cash-advance/state";
import {
  CANONICAL_CA_STATUS_LABEL,
  CANONICAL_CA_STATUS_TONE,
} from "@/lib/cash-advance/state-canonical";
import type { CashAdvanceStatus, CashAdvanceType } from "@/types/database";

import {
  NewCashAdvanceSheet,
  type ProjectOption,
} from "./new-cash-advance-sheet";
import { NewFieldOpsSheet } from "./new-field-ops-sheet";

export const metadata: Metadata = {
  title: "Cash Advances",
};

type Row = {
  id: string;
  amount_db: string;
  purpose: string;
  status: CashAdvanceStatus;
  ca_type: CashAdvanceType;
  needed_by: string | null;
  created_at: string;
  settlement_due_at: string | null;
  project_code: string;
  requester_name: string;
};

type RawRow = {
  id: string;
  amount: string;
  purpose: string;
  status: CashAdvanceStatus;
  ca_type: CashAdvanceType | null;
  needed_by: string | null;
  created_at: string;
  settlement_due_at: string | null;
  projects: { code: string } | null;
  requester: { full_name: string } | null;
};

async function loadRequests(
  caller: { id: string; role: AnyDbEmployeeRole },
): Promise<Row[]> {
  const supabase = await createClient();

  // Rules §3 — approver-OR-self scope. `org` roles (Finance /
  // Director / Admin) see every request in the tenant. Approver
  // roles with a project scope (PM / OM / SPV) see items on
  // scoped projects plus anything they filed themselves. Non-
  // approvers (EMPLOYEE / PCC) see only their own submissions —
  // never someone else's queue.
  const scope = await resolveProjectScope(caller);
  const clause = buildApproverOrSelfClause(
    scope,
    caller.id,
    "requester_employee_id",
    { treatAsApprover: isApproverRole(caller.role) },
  );

  let query = supabase
    .from("cash_advances")
    .select(
      "id, amount, purpose, status, ca_type, needed_by, created_at, settlement_due_at, projects(code), requester:requester_employee_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (clause === "self") {
    query = query.eq("requester_employee_id", caller.id);
  } else if (clause !== null) {
    query = query.or(clause);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const rows = data as unknown as RawRow[];
  return rows.map((row) => ({
    id: row.id,
    amount_db: row.amount,
    purpose: row.purpose,
    status: row.status,
    ca_type: row.ca_type ?? "GENERAL",
    needed_by: row.needed_by,
    created_at: row.created_at,
    settlement_due_at: row.settlement_due_at,
    project_code: row.projects?.code ?? "—",
    requester_name: row.requester?.full_name ?? "—",
  }));
}

/**
 * Compute a "SLA hint" for a DISBURSED cash advance based on how many
 * business days remain until `settlement_due_at`. Returns null if the row
 * is not DISBURSED (nothing to remind about) or missing a due date.
 */
function computeSettlementSlaHint(
  row: Pick<Row, "status" | "settlement_due_at">,
): { tone: string; label: string } | null {
  if (row.status !== "DISBURSED" || !row.settlement_due_at) return null;
  const delta = businessDaysUntil(row.settlement_due_at, new Date());
  if (delta > 3) return null;
  if (delta > 0) {
    return {
      tone: "border-amber-400/40 bg-amber-500/10 text-amber-300",
      label: `SLA H-${delta}`,
    };
  }
  if (delta === 0) {
    return {
      tone: "border-amber-500/50 bg-amber-500/20 text-amber-200",
      label: "SLA hari ini",
    };
  }
  return {
    tone: "border-rose-500/40 bg-rose-500/15 text-rose-300",
    label: `Overdue ${Math.abs(delta)} wd`,
  };
}

/**
 * Prefer the canonical label/tone (GAS-aligned) where defined; fall back
 * to the legacy legend for in-flight PENDING_L* rows.
 */
function caLabel(status: CashAdvanceStatus): string {
  const canonical =
    (CANONICAL_CA_STATUS_LABEL as Partial<Record<CashAdvanceStatus, string>>)[
      status
    ];
  return canonical ?? CA_STATUS_LABEL[status];
}

function caTone(status: CashAdvanceStatus): string {
  const canonical =
    (CANONICAL_CA_STATUS_TONE as Partial<Record<CashAdvanceStatus, string>>)[
      status
    ];
  return canonical ?? CA_STATUS_TONE[status];
}

const CA_TYPE_TONE: Record<CashAdvanceType, string> = {
  GENERAL: "border-slate-400/30 bg-slate-500/10 text-slate-300",
  FIELD_OPS: "border-amber-400/30 bg-amber-500/10 text-amber-300",
};

/**
 * Load project options for the New Cash Advance sheet.
 *
 * Scoping mirrors the PDP contract in `pdp-canonical.ts::decideGeneralCa`:
 *   - PM / OM / DIRECTOR / ADMIN / FINANCE  → all live projects in tenant.
 *   - Everyone else (Employee / Supervisor) → only projects with an ACTIVE
 *     assignment for the actor, unioned across the three assignment sources
 *     (`project_employee_assignments`, `project_pm_assignments`,
 *     `project_assignments`) — same union the RLS gate uses.
 *
 * Serving the full list to unassigned employees was both a privacy leak
 * (they could see every project code/name in the tenant) and a UX trap:
 * picking a project they weren't assigned to would fail PDP with an
 * opaque "not authorized" error.
 */
async function loadProjectOptions(
  actor: { id: string; role: string },
): Promise<ProjectOption[]> {
  const supabase = await createClient();
  const canonical = toCanonicalRole(actor.role as AnyDbEmployeeRole);
  const bypassRoles: readonly CanonicalRole[] = [
    "PM",
    "OM",
    "DIRECTOR",
    "ADMIN",
    "FINANCE",
  ];
  const shouldBypass = bypassRoles.includes(canonical);

  if (shouldBypass) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, code, name")
      .in("status", ["PLANNING", "ACTIVE"])
      .order("name", { ascending: true })
      .limit(500);
    if (error || !data) return [];
    return data.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }));
  }

  const [pea, ppa, pa] = await Promise.all([
    supabase
      .from("project_employee_assignments")
      .select("project_id")
      .eq("employee_id", actor.id)
      .eq("status", "ACTIVE"),
    supabase
      .from("project_pm_assignments")
      .select("project_id")
      .eq("pm_employee_id", actor.id)
      .eq("status", "ACTIVE"),
    supabase
      .from("project_assignments")
      .select("project_id")
      .eq("employee_id", actor.id)
      .eq("status", "ACTIVE"),
  ]);

  const ids = new Set<string>();
  for (const row of pea.data ?? []) if (row.project_id) ids.add(row.project_id);
  for (const row of ppa.data ?? []) if (row.project_id) ids.add(row.project_id);
  for (const row of pa.data ?? []) if (row.project_id) ids.add(row.project_id);
  if (ids.size === 0) return [];

  const { data, error } = await supabase
    .from("projects")
    .select("id, code, name")
    .in("id", Array.from(ids))
    .in("status", ["PLANNING", "ACTIVE"])
    .order("name", { ascending: true })
    .limit(500);
  if (error || !data) return [];
  return data.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }));
}

export default async function CashAdvancesPage() {
  const employee = await requireCurrentEmployee();
  const [rows, projectOptions, lookups, t, tTypes] = await Promise.all([
    loadRequests({
      id: employee.id,
      role: employee.role as AnyDbEmployeeRole,
    }),
    loadProjectOptions({ id: employee.id, role: employee.role }),
    loadFieldOpsFormLookups(),
    getTranslations("cashAdvances"),
    getTranslations("cashAdvances.types"),
  ]);

  // Per-project unit_pengaju whitelist. Serialised into a plain object
  // because Client Components can't accept `Map` across the RSC/RC
  // boundary. The Field-Ops sheet keys into this by project ID whenever
  // the user picks a project; missing key = fall back to full tenant
  // lookup list (migration 0086 comment explains the fallback intent).
  const allowedUnitsMap = await loadAllowedUnitsForProjects(
    projectOptions.map((p) => p.id),
  );
  const allowedUnitsByProject: Record<string, string[]> = Object.fromEntries(
    allowedUnitsMap.entries(),
  );

  // Field-tech gating: the "Pengajuan Operasional" button is enabled
  // whenever the actor has at least one ACTIVE FIELD_TECHNICIAN
  // assignment. Higher-rank roles (Supervisor+, PM, OM, Finance,
  // Director, Admin) always get access as an escalation lane — this
  // mirrors the PDP contract in `pdp-canonical.ts::decideFieldOpsCa`.
  const supabase = await createClient();
  const { data: fieldTechFlag } = await supabase.rpc(
    "has_active_field_tech_assignment",
    { p_emp_id: employee.id },
  );
  const escalationRoles: readonly string[] = [
    "SUPERVISOR",
    "PROJECT_MANAGER",
    "PM",
    "OPERATIONS_MANAGER",
    "OM",
    "LEAD_FINANCE",
    "FINANCE",
    "HEAD_MANAGER",
    "GENERAL_MANAGER",
    "DIRECTOR",
    "TENANT_ADMIN",
    "ADMIN",
  ];
  const isFieldTech = Boolean(fieldTechFlag);
  const isEscalation = escalationRoles.includes(employee.role as string);
  const canFieldOps = isFieldTech || isEscalation;
  // Base employees who are field techs shouldn't be able to file the
  // regular "General" CA — they've been onboarded to the Field-Ops flow
  // instead. Escalation roles keep access to both.
  const canGeneral = !isFieldTech || isEscalation;

  // Only classification-eligible roles (PM / Finance / OM+ / Admin) see
  // the inline CoA picker on the New CA sheet + per-RAB CoA on Field
  // Ops. Field Tech + Employee submitters get their advances coded by
  // Finance during review. Same policy as the expense sheet.
  const CA_COA_ROLES: readonly string[] = [
    "PROJECT_MANAGER",
    "LEAD_FINANCE",
    "OPERATIONS_MANAGER",
    "HEAD_MANAGER",
    "GENERAL_MANAGER",
    "DIRECTOR",
    "TENANT_ADMIN",
    "ADMIN",
  ];
  const canPickCoa = CA_COA_ROLES.includes(employee.role as string);

  const typeLabel: Record<CashAdvanceType, string> = {
    GENERAL: tTypes("general"),
    FIELD_OPS: tTypes("fieldOps"),
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NewFieldOpsSheet
            projects={projectOptions}
            isFieldTech={canFieldOps}
            disabled={!canFieldOps}
            disabledReason={
              canFieldOps ? undefined : t("newFieldOpsDisabled")
            }
            lookups={lookups}
            allowedUnitsByProject={allowedUnitsByProject}
            canPickCoa={canPickCoa}
          />
          <NewCashAdvanceSheet
            projects={projectOptions}
            disabled={!canGeneral}
            disabledReason={canGeneral ? undefined : t("newGeneralDisabled")}
            canFieldOps={canFieldOps}
            canPickCoa={canPickCoa}
            unitOptions={lookups.unit_pengaju}
            allowedUnitsByProject={allowedUnitsByProject}
          />
        </div>
      </header>

      {rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Wallet className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("empty")}
            </CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>{t("columns.project")}</Th>
                    <Th>{t("columns.type")}</Th>
                    <Th>{t("columns.requester")}</Th>
                    <Th>{t("columns.purpose")}</Th>
                    <Th className="text-right">{t("columns.amount")}</Th>
                    <Th>{t("columns.neededBy")}</Th>
                    <Th>{t("columns.status")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.project_code}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={CA_TYPE_TONE[r.ca_type]}
                        >
                          {typeLabel[r.ca_type]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/finance/cash-advances/${r.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {r.requester_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 max-w-md truncate">
                        {r.purpose}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(parseMoneyFromDb(r.amount_db), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {r.needed_by
                          ? formatInTz(r.needed_by, "dd MMM yyyy")
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <FinanceStatusBadge
                            tone={caTone(r.status)}
                            label={caLabel(r.status)}
                          />
                          {(() => {
                            const hint = computeSettlementSlaHint(r);
                            return hint ? (
                              <Badge
                                variant="outline"
                                className={hint.tone}
                                aria-label={`Settlement SLA — ${hint.label}`}
                              >
                                {hint.label}
                              </Badge>
                            ) : null;
                          })()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`label-meta px-4 py-3 text-xs font-medium text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
