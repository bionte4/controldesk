import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  Flag,
  Users,
  Wallet,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatInTz } from "@/lib/format/date";
import { formatIDRWithMask, parseMoneyFromDb } from "@/lib/format/money";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import {
  formatRole,
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type EmployeeRole,
} from "@/lib/rbac/roles";
import { authorize } from "@/lib/security/pdp";
import { resolveProjectScope } from "@/lib/security/project-scope";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadWorkload } from "@/lib/data/assignments";
import { NewAssignmentSheet } from "@/app/(app)/assignments/new-assignment-sheet";
import {
  hasApprovedBudget,
  hasActivePmAssignment,
} from "@/lib/data/projects";
import { STATUS_LABEL, STATUS_TONE as EXPENSE_STATUS_TONE } from "@/lib/expenses/state";
import {
  MILESTONE_STATUS_LABEL,
  MILESTONE_STATUS_TONE,
  WEIGHT_BPS_MAX,
  bpsToPercent,
  sumWeightBps,
} from "@/lib/milestones/state";
import type {
  ExpenseStatus as ExpenseStatusEnum,
  MilestoneStatus,
  ProjectStatus,
} from "@/types/database";

import {
  NewMilestoneSheet,
  type EmployeeOption,
} from "./milestones/new-milestone-sheet";
import { MilestoneRowActions } from "./milestones/milestone-row-actions";
import { EditMilestoneSheet } from "./milestones/edit-milestone-sheet";
import { ProjectIssuesSection } from "./issues/issues-section";
import type { IssueAssigneeOption } from "./issues/new-issue-sheet";
import { ProjectDirectLaborSection } from "./direct-labor-section";
import { ProjectTasksSection } from "./tasks/tasks-section";
import {
  ProjectLifecycleBanner,
  type PmPickOption,
} from "./lifecycle-banner";
import { EditProjectSheet } from "./edit-project-sheet";
import { EditBusinessCaseSheet } from "./edit-business-case-sheet";

export const metadata: Metadata = { title: "Project detail" };

const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  PLANNING: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ON_HOLD: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  COMPLETED: "bg-primary/15 text-primary border-primary/30",
  ARCHIVED: "bg-muted text-muted-foreground border-border",
};

export default async function ProjectDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const [employee, t, tStatus, tMilestones, tMilestoneStatus] =
    await Promise.all([
      requireCurrentEmployee(),
      getTranslations("projects.detail"),
      getTranslations("projects.status"),
      getTranslations("milestones"),
      getTranslations("milestones.status"),
    ]);

  // ABAC guard (rules §3, §7): Employees / Supervisors / PMs / OM
  // may only open detail pages for projects they are assigned to
  // (directly or, for OM/HM, via a report-chain subordinate).
  // A URL-pasted UUID for someone else's project must render as
  // `notFound()` rather than 403 — keeps the address undiscoverable
  // per the same rationale as the shifts/CoA pages.
  const scope = await resolveProjectScope({
    id: employee.id,
    role: employee.role as AnyDbEmployeeRole,
  });
  if (scope.kind !== "org" && !scope.projectIds.includes(id)) {
    notFound();
  }

  // Rules §3 — budget/expense sections on the project detail page
  // are gated on the `view_budget` capability. When the caller
  // cannot see budgets, we (1) skip both queries entirely so the RSC
  // payload never carries amounts, and (2) suppress the two cards
  // that render them. Resolved via `resolveCapabilitiesFor()` so
  // any per-tenant admin override at `/settings/capabilities` takes
  // effect here too.
  const capabilities = await resolveCapabilitiesFor();
  const showBudget = capabilities.can("view_budget");
  // Rules §3 / rules §9 — PM & OM keep the budget summary card and
  // the recent-expenses list (they still need to know an approved
  // budget exists + submit expenses against a MA), but the spent-of
  // pair renders as `Rp ******`. Expense amounts on this page follow
  // the same gate. Full nominal only for Finance-leader tier.
  const canViewAmount = capabilities.can("view_budget_amount");

  const supabase = await createClient();

  type PmRow = {
    id: string;
    assignment_role: string;
    status: string;
    started_at: string;
    employees: { id: string; full_name: string; role: string } | null;
  };
  type EmpRow = {
    id: string;
    allocation_percentage: number;
    status: string;
    started_at: string;
    employees: { id: string; full_name: string; role: string } | null;
  };
  type ExpenseRow = {
    id: string;
    amount: string;
    category: string;
    description: string;
    status: string;
    incurred_on: string;
    created_at: string;
  };
  type MilestoneRow = {
    id: string;
    seq: number;
    name: string;
    description: string | null;
    weight_bps: number;
    status: MilestoneStatus;
    planned_start_date: string | null;
    planned_end_date: string | null;
    actual_start_date: string | null;
    actual_end_date: string | null;
    owner_employee_id: string | null;
    owner: { id: string; full_name: string } | null;
  };
  type EmpDirectoryRow = {
    id: string;
    full_name: string;
    role: string;
  };

  const [
    { data: project },
    { data: pmRaw },
    { data: empRaw },
    { data: budgetRow },
    { data: expRaw },
    { data: mlRaw },
    { data: empDirectoryRaw },
  ] = await Promise.all([
    supabase
      .from("projects")
      // Explicit column list (WITHOUT `contract_value`) because that
      // column is REVOKE'd from `authenticated` in migration 0102 —
      // a `select("*")` would fail with `permission denied for column
      // contract_value`. The value is fetched separately below via a
      // service-role client, gated on `canEditProject`.
      .select(
        `id, tenant_id, code, project_number, name, description, priority,
         project_type, status, progress, currency, location, start_date,
         end_date, notes, sync_calendar, client_id, contract_id, created_by,
         created_at, updated_at, bc_executive_summary, bc_sponsor_id,
         bc_target_gm_pct, bc_approved_at, bc_approved_by,
         clients(id, name)`,
      )
      .eq("id", id)
      .eq("tenant_id", employee.tenant_id)
      .maybeSingle(),
    supabase
      .from("project_pm_assignments")
      .select(
        "id, assignment_role, status, started_at, employees:pm_employee_id(id, full_name, role)",
      )
      .eq("project_id", id)
      .eq("tenant_id", employee.tenant_id)
      .order("assignment_role", { ascending: true }),
    supabase
      .from("project_employee_assignments")
      .select(
        "id, allocation_percentage, status, started_at, employees:employee_id(id, full_name, role)",
      )
      .eq("project_id", id)
      .eq("tenant_id", employee.tenant_id)
      .eq("status", "ACTIVE")
      .order("allocation_percentage", { ascending: false }),
    // Async IIFE wrappers normalise both branches to the same
    // `{ data }` shape without conflicting with the Supabase-generated
    // types. Downstream code coerces amounts via `parseMoneyFromDb`,
    // so the row shape is intentionally kept loose here.
    (async (): Promise<{ data: { budget_amount: unknown; spent_amount: unknown } | null }> => {
      if (!showBudget) return { data: null };
      const res = await supabase
        .from("project_budgets")
        .select("budget_amount, spent_amount")
        .eq("project_id", id)
        .eq("tenant_id", employee.tenant_id)
        .maybeSingle();
      return {
        data: res.data as { budget_amount: unknown; spent_amount: unknown } | null,
      };
    })(),
    (async (): Promise<{ data: unknown[] }> => {
      if (!showBudget) return { data: [] };
      const res = await supabase
        .from("project_expenses")
        .select(
          "id, amount, category, description, status, incurred_on, created_at",
        )
        .eq("project_id", id)
        .eq("tenant_id", employee.tenant_id)
        .order("created_at", { ascending: false })
        .limit(10);
      return { data: (res.data ?? []) as unknown[] };
    })(),
    supabase
      .from("project_milestones")
      .select(
        `id, seq, name, description, weight_bps, status, planned_start_date,
         planned_end_date, actual_start_date, actual_end_date, owner_employee_id,
         owner:employees!project_milestones_owner_employee_id_fkey(id, full_name)`,
      )
      .eq("project_id", id)
      .eq("tenant_id", employee.tenant_id)
      .order("seq", { ascending: true }),
    supabase
      .from("employees")
      .select("id, full_name, role")
      .eq("tenant_id", employee.tenant_id)
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(500),
  ]);

  if (!project) notFound();

  const pmAssignments = (pmRaw ?? []) as unknown as PmRow[];
  const employeeAssignments = (empRaw ?? []) as unknown as EmpRow[];
  const recentExpenses = (expRaw ?? []) as unknown as ExpenseRow[];
  const milestones = (mlRaw ?? []) as unknown as MilestoneRow[];
  const employeeDirectory = (empDirectoryRaw ?? []) as unknown as EmpDirectoryRow[];

  const client = project.clients as unknown as { id: string; name: string } | null;

  // `parseMoneyFromDb` accepts string | number | null (generated
  // types return number, runtime is a stringified numeric). Cast
  // through `as` so the loosened row type stays compatible.
  const budget = budgetRow
    ? {
        amount: parseMoneyFromDb(
          budgetRow.budget_amount as string | number | null,
        ),
        spent: parseMoneyFromDb(
          budgetRow.spent_amount as string | number | null,
        ),
      }
    : null;

  const spentPct =
    budget && budget.amount > 0n
      ? Number((budget.spent * 1000n) / budget.amount) / 10
      : 0;

  const primaryPm = pmAssignments.find(
    (a) => a.assignment_role === "PRIMARY_PM" && a.status === "ACTIVE",
  );

  const canonicalRole = toCanonicalRole(employee.role as AnyDbEmployeeRole);
  const canEditMilestones =
    canonicalRole === "PM" ||
    canonicalRole === "OM" ||
    canonicalRole === "DIRECTOR" ||
    canonicalRole === "ADMIN";

  // OM+ / TENANT_ADMIN may edit project meta (name, timeline, contract
  // value, etc.). Mirrors PDP `decideProject('update')` — keep both in
  // sync (rules §17: PDP is single source of truth). Delegate the
  // decision to `authorize()` so RLS + Server Action + UI all agree.
  const canEditProject =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "update",
      resource: "project",
      attributes: { tenantId: employee.tenant_id },
    }).effect === "ALLOW";

  // Contract value (rules §3) — REVOKE'd from `authenticated` in
  // migration 0102 so a plain-JWT SELECT would fail. Fetch via
  // service role ONLY when the caller has passed `decideProject.update`
  // above. `EditProjectSheet` is the only downstream consumer; if
  // the caller can't edit, we don't touch the column at all (the value
  // isn't rendered anywhere else on this page).
  let projectContractValue: number | string | null = null;
  if (canEditProject) {
    const serviceClient = createServiceRoleClient();
    const { data: cv } = await serviceClient
      .from("projects")
      .select("contract_value")
      .eq("id", id)
      .eq("tenant_id", employee.tenant_id)
      .maybeSingle();
    projectContractValue = (cv?.contract_value as number | string | null) ?? null;
  }
  const canDeleteMilestones =
    canonicalRole === "OM" ||
    canonicalRole === "DIRECTOR" ||
    canonicalRole === "ADMIN";

  // Tasks (WBS) — canonical PDP `decideProjectTask` (pdp-canonical.ts):
  //   SUPERVISOR / PM / OM / DIRECTOR / ADMIN may CREATE + UPDATE.
  //   PM / OM / DIRECTOR / ADMIN may DELETE.
  // Mirror those role gates client-side so the row-actions menu (Edit,
  // Add child, status transitions, progress presets, delete) hides for
  // viewers who would only get a 403 from the server. Server still
  // enforces via `withSecureAction()` — this is UX, not security.
  const canManageTasks =
    canonicalRole === "SUPERVISOR" ||
    canonicalRole === "PM" ||
    canonicalRole === "OM" ||
    canonicalRole === "DIRECTOR" ||
    canonicalRole === "ADMIN";
  const canDeleteTasks =
    canonicalRole === "PM" ||
    canonicalRole === "OM" ||
    canonicalRole === "DIRECTOR" ||
    canonicalRole === "ADMIN";

  // PM+ boleh menambah anggota tim proyek. Delegasikan keputusan ke PDP
  // (satu source of truth dengan Server Action) — rules §17.
  const canManageTeam =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "create",
      resource: "project_employee_assignment",
      attributes: { tenantId: employee.tenant_id },
    }).effect === "ALLOW";

  // Live workload lookup untuk indikator kapasitas di dialog assign.
  // Hanya di-load kalau PM+ (hemat query untuk role read-only).
  const workload = canManageTeam ? await loadWorkload() : [];
  const workloadLookup: Record<string, { total: number; remaining: number }> =
    {};
  for (const w of workload) {
    workloadLookup[w.employee_id] = {
      total: w.total_alloc_pct,
      remaining: w.remaining_pct,
    };
  }

  const lockedProjectLabel = `${project.project_number ?? project.code ?? "—"} — ${project.name}`;

  const nextMilestoneSeq =
    milestones.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
  const usedWeightBps = sumWeightBps(milestones);
  const remainingWeightBps = Math.max(0, WEIGHT_BPS_MAX - usedWeightBps);
  const progressPct = Number(project.progress ?? 0);

  const employeeOptions: EmployeeOption[] = employeeDirectory.map((e) => ({
    id: e.id,
    label: `${e.full_name} · ${formatRole(e.role as Parameters<typeof formatRole>[0])}`,
  }));

  // Lifecycle banner context. Fetch approval + PM-assignment flags in
  // parallel. Both queries are trivially cheap (COUNT with head=true).
  // Only OM / HM / ADMIN can promote / activate.
  const canManageLifecycle =
    canonicalRole === "OM" ||
    canonicalRole === "DIRECTOR" ||
    canonicalRole === "ADMIN";
  const [budgetApproved, pmAssigned] = await Promise.all([
    hasApprovedBudget(id),
    hasActivePmAssignment(id),
  ]);
  const hasBcMinimum = Boolean(
    project.bc_executive_summary &&
      project.bc_executive_summary.trim().length > 0 &&
      project.bc_sponsor_id,
  );
  // PM options for the activate sheet — reuse the employee directory
  // (already scoped to this tenant) filtered to PM-eligible roles.
  const pmPickOptions: PmPickOption[] = employeeDirectory
    .filter((e) =>
      ["PROJECT_MANAGER", "OPERATIONS_MANAGER", "HEAD_MANAGER", "TENANT_ADMIN"].includes(
        e.role,
      ),
    )
    .map((e) => ({
      id: e.id,
      name: e.full_name,
      role: formatRole(e.role as Parameters<typeof formatRole>[0]),
    }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/projects" />}
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="size-6" />
          </div>
          <div>
            <p className="label-meta">
              {t("kicker")}
              <span className="font-mono ml-2 text-muted-foreground">
                {project.code}
              </span>
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge
                variant="outline"
                className={PROJECT_STATUS_TONE[project.status as ProjectStatus]}
              >
                {tStatus(project.status as ProjectStatus)}
              </Badge>
              {client ? (
                <span>
                  ·{" "}
                  <Link
                    href={`/clients/${client.id}`}
                    className="hover:text-primary"
                  >
                    {client.name}
                  </Link>
                </span>
              ) : null}
              {project.start_date ? (
                <span>· {formatInTz(project.start_date, "dd MMM yyyy")}</span>
              ) : null}
              {project.end_date ? (
                <span>
                  – {formatInTz(project.end_date, "dd MMM yyyy")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {canEditProject ? (
          <div className="flex flex-wrap items-center gap-2">
            <EditProjectSheet
              project={{
                id: project.id as string,
                name: project.name as string,
                description: (project.description as string | null) ?? null,
                priority: (project.priority as string | null) ?? "MEDIUM",
                project_type: project.project_type as string,
                location: (project.location as string | null) ?? null,
                start_date: (project.start_date as string | null) ?? null,
                end_date: (project.end_date as string | null) ?? null,
                contract_value: projectContractValue,
                currency: (project.currency as string | null) ?? "IDR",
                notes: (project.notes as string | null) ?? null,
                sync_calendar:
                  (project.sync_calendar as boolean | null) ?? true,
              }}
            />
            {project.status === "DRAFT" || project.status === "PLANNING" ? (
              <EditBusinessCaseSheet
                project={{
                  id: project.id as string,
                  bc_executive_summary:
                    (project.bc_executive_summary as string | null) ?? null,
                  bc_target_gm_pct:
                    (project.bc_target_gm_pct as number | string | null) ??
                    null,
                  bc_sponsor_id:
                    (project.bc_sponsor_id as string | null) ?? null,
                }}
                sponsors={employeeOptions.map((e) => ({
                  id: e.id,
                  label: e.label,
                }))}
              />
            ) : null}
          </div>
        ) : null}
      </header>

      <ProjectLifecycleBanner
        projectId={project.id}
        status={project.status as ProjectStatus}
        hasApprovedBudget={budgetApproved}
        hasActivePm={pmAssigned}
        hasBcMinimum={hasBcMinimum}
        canManageLifecycle={canManageLifecycle}
        pmOptions={pmPickOptions}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          render={<Link href={`/projects/${id}/monthly-reports`} />}
        >
          <CalendarClock className="size-4" />
          Monthly reports
        </Button>
      </div>

      <div
        className={
          showBudget
            ? "grid grid-cols-1 lg:grid-cols-3 gap-4"
            : "grid grid-cols-1 gap-4"
        }
      >
        {showBudget ? (
          <Card className="glass lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="size-4" /> {t("budgetTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!budget ? (
                <p className="text-sm text-muted-foreground">
                  {t("budgetEmpty")}
                </p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="label-meta">{t("budgetSpent")}</p>
                      <p className="font-display text-2xl font-semibold">
                        {formatIDRWithMask(budget.spent, canViewAmount, {
                          compact: true,
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="label-meta">{t("budgetOf")}</p>
                      <p className="font-mono text-sm text-muted-foreground">
                        {formatIDRWithMask(budget.amount, canViewAmount, {
                          compact: true,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    {/*
                     * Progress bar visually conveys utilisation, which
                     * itself leaks rough budget headroom (e.g. a
                     * near-full bar reveals over-budget risk). Under
                     * mask we still render the bar but drop the
                     * numeric percent — approvers who lack amount
                     * access get a hint but not the precise ratio.
                     */}
                    <Progress value={Math.min(100, spentPct)} />
                    {canViewAmount ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {spentPct.toFixed(1)}% {t("budgetUsed")}
                      </p>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card className="glass">
          <CardHeader>
            <CardTitle>{t("primaryPmTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {primaryPm ? (
              <div>
                <p className="font-semibold">
                  {primaryPm.employees?.full_name ?? "—"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {primaryPm.employees?.role
                    ? formatRole(
                        primaryPm.employees.role as Parameters<
                          typeof formatRole
                        >[0],
                      )
                    : ""}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("since", {
                    date: formatInTz(primaryPm.started_at, "dd MMM yyyy"),
                  })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("noPrimaryPm")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="glass overflow-hidden">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Flag className="size-4 text-primary" />
              {tMilestones("title")}
            </CardTitle>
            <CardDescription>
              {tMilestones("subtitle", {
                progress: progressPct.toFixed(1),
                used: bpsToPercent(usedWeightBps).toFixed(2),
              })}
            </CardDescription>
          </div>
          {canEditMilestones ? (
            <NewMilestoneSheet
              projectId={project.id}
              nextSeq={nextMilestoneSeq}
              remainingBps={remainingWeightBps}
              employees={employeeOptions}
            />
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-t border-border/50 px-6 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="label-meta">
                {tMilestones("progressLabel")}
              </span>
              <span className="tabular-nums text-sm font-medium">
                {progressPct.toFixed(1)}%
              </span>
            </div>
            <Progress value={Math.min(100, progressPct)} className="mt-2 h-2" />
            <p className="mt-1 text-xs text-muted-foreground">
              {tMilestones("weightBudget", {
                used: bpsToPercent(usedWeightBps).toFixed(2),
                remaining: bpsToPercent(remainingWeightBps).toFixed(2),
              })}
            </p>
          </div>

          {milestones.length === 0 ? (
            <div className="border-t border-border/50 px-6 py-8 text-center text-sm text-muted-foreground">
              {tMilestones("empty")}
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-border/50">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>#</Th>
                    <Th>{tMilestones("columns.name")}</Th>
                    <Th className="text-right">
                      {tMilestones("columns.weight")}
                    </Th>
                    <Th>{tMilestones("columns.owner")}</Th>
                    <Th>{tMilestones("columns.dueDate")}</Th>
                    <Th>{tMilestones("columns.status")}</Th>
                    <Th className="w-10">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m) => (
                    <tr
                      key={m.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {m.seq}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{m.name}</p>
                        {m.description ? (
                          <p className="mt-0.5 max-w-md text-xs text-muted-foreground line-clamp-2">
                            {m.description}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {bpsToPercent(m.weight_bps).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {m.owner?.full_name ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {m.planned_end_date
                          ? formatInTz(m.planned_end_date, "dd MMM yyyy")
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={MILESTONE_STATUS_TONE[m.status]}
                          title={MILESTONE_STATUS_LABEL[m.status]}
                        >
                          {tMilestoneStatus(m.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canEditMilestones ? (
                            <EditMilestoneSheet
                              milestone={{
                                id: m.id,
                                seq: m.seq,
                                name: m.name,
                                description: m.description,
                                weight_bps: m.weight_bps,
                                planned_start_date: m.planned_start_date,
                                planned_end_date: m.planned_end_date,
                                owner_employee_id: m.owner_employee_id,
                              }}
                              employees={employeeOptions}
                              // otherWeightBps = total across the project
                              // minus this row (so the friendly cap in
                              // the sheet header reflects reality).
                              otherWeightBps={milestones.reduce(
                                (sum, row) =>
                                  row.id === m.id ? sum : sum + row.weight_bps,
                                0,
                              )}
                            />
                          ) : null}
                          <MilestoneRowActions
                            id={m.id}
                            status={m.status}
                            canEdit={canEditMilestones}
                            canDelete={canDeleteMilestones}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div
        className={
          showBudget
            ? "grid grid-cols-1 lg:grid-cols-2 gap-4"
            : "grid grid-cols-1 gap-4"
        }
      >
        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" /> {t("teamTitle")}
            </CardTitle>
            {canManageTeam ? (
              <NewAssignmentSheet
                projects={[]}
                employees={employeeDirectory.map((e) => ({
                  id: e.id,
                  full_name: e.full_name,
                  role: e.role,
                }))}
                workload={workloadLookup}
                triggerLabel={t("addTeamMember")}
                buttonVariant="outline"
                lockedProject={{
                  id: project.id as string,
                  label: lockedProjectLabel,
                }}
              />
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {employeeAssignments.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {t("teamEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-border/50">
                {employeeAssignments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">
                        {a.employees?.full_name ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.employees?.role
                          ? formatRole(
                              a.employees.role as Parameters<
                                typeof formatRole
                              >[0],
                            )
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-32">
                        <Progress
                          value={Math.min(100, a.allocation_percentage)}
                        />
                      </div>
                      <span className="w-10 text-right tabular-nums text-sm">
                        {a.allocation_percentage}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {showBudget ? (
          <Card className="glass">
          <CardHeader>
            <CardTitle>{t("expensesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentExpenses.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {t("expensesEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-border/50">
                {recentExpenses.map((e) => {
                  const status = e.status as ExpenseStatusEnum;
                  return (
                    <Link
                      key={e.id}
                      href={`/finance/expenses/${e.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {e.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatInTz(e.incurred_on, "dd MMM yyyy")} · {e.category}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums text-sm">
                          {formatIDRWithMask(
                            parseMoneyFromDb(e.amount),
                            canViewAmount,
                            { compact: true },
                          )}
                        </span>
                        <Badge
                          variant="outline"
                          className={EXPENSE_STATUS_TONE[status]}
                        >
                          {STATUS_LABEL[status]}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
          </Card>
        ) : null}
      </div>

      <ProjectTasksSection
        projectId={id}
        tenantId={employee.tenant_id}
        canManage={canManageTasks}
        canDelete={canDeleteTasks}
      />

      {/* Direct Labor Cost surfaces per-employee hourly rate + cost —
          this is derived payroll data. Gate behind the same
          `view_budget` capability so Employees / Supervisors don't
          see either their teammates' or their own labor cost in a
          project cross-section. A dedicated `view_project_labor_cost`
          capability may split from this in Fase 2. */}
      {showBudget ? <ProjectDirectLaborSection projectId={id} /> : null}

      <ProjectIssuesSection
        projectId={id}
        projectLabel={`${project.project_number ?? project.code ?? "—"} — ${project.name}`}
        employees={
          employeeDirectory.map((e) => ({
            id: e.id,
            label: `${e.full_name} · ${formatRole(
              e.role as Parameters<typeof formatRole>[0],
            )}`,
          })) satisfies IssueAssigneeOption[]
        }
        canAct={
          canonicalRole === "EMPLOYEE" ||
          canonicalRole === "SUPERVISOR" ||
          canonicalRole === "PM" ||
          canonicalRole === "OM" ||
          canonicalRole === "DIRECTOR" ||
          canonicalRole === "ADMIN"
        }
        // project.priority mirrors project_issue_severity 1:1 — the enums
        // share values (CRITICAL/HIGH/MEDIUM/LOW). New issues default to
        // the project's priority so a Critical project gets a 1h SLA
        // instead of the generic 8h.
        defaultSeverity={
          (project.priority ??
            "MEDIUM") as import("@/types/database").ProjectIssueSeverity
        }
      />

      {project.description ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle>{t("descriptionTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {project.description}
            </p>
          </CardContent>
        </Card>
      ) : null}
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
