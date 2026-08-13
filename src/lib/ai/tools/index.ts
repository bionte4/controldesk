import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { log } from "@/lib/observability/log";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import type {
  AnyDbEmployeeRole,
  CanonicalRole,
} from "@/lib/rbac/roles";
import { toCanonicalRole } from "@/lib/rbac/roles";
import type { createClient } from "@/lib/supabase/server";

/**
 * Level 2 ("Ask my data") tool registry.
 *
 * ## Contract
 *
 *   • Tools are **read-only** and **scoped to the caller**. Every
 *     tool closes over the session context (`tenantId`, `employeeId`,
 *     `userId`, `canonicalRole`) and injects them into every query.
 *     Model-supplied arguments CAN NOT override these — the input
 *     schemas don't accept them at all.
 *   • Tools return **domain-shaped summaries**, not row dumps. Lists
 *     cap at 10 items; anything bigger collapses into a total + top.
 *   • Tools never touch tables outside their whitelist and never
 *     JOIN across tenants. The session-scoped Supabase client makes
 *     RLS the defence-in-depth safety net if the app-layer scope
 *     were ever bypassed.
 *
 * See `docs/rfc/0001-ask-my-data.md` for the full threat model and
 * why each argument is fixed rather than parameterised.
 */

export type ToolContext = {
  tenantId: string;
  employeeId: string;
  userId: string;
  canonicalRole: CanonicalRole;
  dbRole: AnyDbEmployeeRole;
  locale: "id" | "en";
  /** Session-scoped Supabase client. RLS-enforced. */
  supabase: Awaited<ReturnType<typeof createClient>>;
};

/** Trace entry stored on the assistant chat_messages row. */
export type ToolTrace = {
  name: string;
  arguments: Record<string, unknown>;
  result_preview: string;
  duration_ms: number;
  ok: boolean;
};

const MAX_ITEMS = 10;

// ---------------------------------------------------------------------------
// list_pending_approvals
// ---------------------------------------------------------------------------

const listPendingApprovalsInput = z.object({});

/**
 * Which expense_status / cash_advance_status values expect approval
 * from the caller's canonical role. Level 2 leaks nothing to a user
 * who cannot act on the item — they'd have to navigate to
 * /approvals anyway, and see a wall of "you can't approve this"
 * items.
 */
type ExpenseStatus =
  | "PENDING_L1_SUPERVISOR"
  | "PENDING_L2_PROJECT_MANAGER"
  | "PENDING_L2_5_FINANCE"
  | "PENDING_L3_OPERATIONS_MANAGER"
  | "PENDING_L4_HEAD_MANAGER"
  | "PENDING_L5_GENERAL_MANAGER";

type CaStatus =
  | "PENDING_L1_SUPERVISOR"
  | "PENDING_L2_PROJECT_MANAGER"
  | "PENDING_L2_5_FINANCE"
  | "PENDING_L3_OPERATIONS_MANAGER"
  | "PENDING_L4_HEAD_MANAGER"
  | "PENDING_L5_GENERAL_MANAGER"
  | "PENDING_SUPERVISOR"
  | "PENDING_PM"
  | "PENDING_FINANCE"
  | "PENDING_OM"
  | "PENDING_DIRECTOR";

function statusesAwaiting(
  role: CanonicalRole,
): {
  expense: readonly ExpenseStatus[];
  ca: readonly CaStatus[];
} {
  // Two schemas exist because CA got the canonical rename first
  // (PENDING_SUPERVISOR, etc.) — expense still uses the legacy
  // Lnnn names. `role` is the caller's *canonical* role
  // (post-`toCanonicalRole()`); see rules §6 for the DB→canonical
  // mapping.
  switch (role) {
    case "SUPERVISOR":
      return {
        expense: ["PENDING_L1_SUPERVISOR"],
        ca: ["PENDING_L1_SUPERVISOR", "PENDING_SUPERVISOR"],
      };
    case "PM":
      return {
        expense: ["PENDING_L2_PROJECT_MANAGER"],
        ca: ["PENDING_L2_PROJECT_MANAGER", "PENDING_PM"],
      };
    case "FINANCE":
      return {
        expense: ["PENDING_L2_5_FINANCE"],
        ca: ["PENDING_L2_5_FINANCE", "PENDING_FINANCE"],
      };
    case "OM":
      return {
        expense: ["PENDING_L3_OPERATIONS_MANAGER"],
        ca: ["PENDING_L3_OPERATIONS_MANAGER", "PENDING_OM"],
      };
    case "DIRECTOR":
    case "ADMIN":
      return {
        expense: ["PENDING_L4_HEAD_MANAGER", "PENDING_L5_GENERAL_MANAGER"],
        ca: [
          "PENDING_L4_HEAD_MANAGER",
          "PENDING_L5_GENERAL_MANAGER",
          "PENDING_DIRECTOR",
        ],
      };
    case "EMPLOYEE":
    default:
      return { expense: [], ca: [] };
  }
}

/**
 * Approvals awaiting THIS caller's action based on their canonical
 * role. Empty-role users (regular employees) get an empty result,
 * not a tenant-wide dump.
 */
async function runListPendingApprovals(ctx: ToolContext): Promise<{
  total: number;
  items: Array<{
    type: "expense" | "cash_advance" | "hr_request" | "budget_request";
    id: string;
    label: string;
    amount_label: string | null;
    submitted_at: string | null;
  }>;
  overflow: boolean;
}> {
  const supabase = ctx.supabase;
  const awaiting = statusesAwaiting(ctx.canonicalRole);
  // Fast path: role doesn't approve anything → return empty without
  // spending DB round trips. This is the common case for EMPLOYEE.
  if (awaiting.expense.length === 0 && awaiting.ca.length === 0) {
    return { total: 0, items: [], overflow: false };
  }

  const expenseP = awaiting.expense.length
    ? supabase
        .from("project_expenses")
        .select("id, description, amount, submitted_at, status")
        .in("status", awaiting.expense)
        .order("submitted_at", { ascending: false })
        .limit(MAX_ITEMS)
    : Promise.resolve({ data: [] as never[] });

  const caP = awaiting.ca.length
    ? supabase
        .from("cash_advances")
        .select("id, purpose, amount, created_at, status")
        .in("status", awaiting.ca)
        .order("created_at", { ascending: false })
        .limit(MAX_ITEMS)
    : Promise.resolve({ data: [] as never[] });

  const [{ data: expenses }, { data: cas }] = await Promise.all([expenseP, caP]);

  const items: Awaited<ReturnType<typeof runListPendingApprovals>>["items"] =
    [];
  for (const e of expenses ?? []) {
    items.push({
      type: "expense",
      id: e.id,
      label: e.description ?? "(untitled expense)",
      amount_label: e.amount != null ? formatIDR(parseMoneyFromDb(e.amount)) : null,
      submitted_at: e.submitted_at,
    });
  }
  for (const c of cas ?? []) {
    items.push({
      type: "cash_advance",
      id: c.id,
      label: c.purpose ?? "(cash advance)",
      amount_label: c.amount != null ? formatIDR(parseMoneyFromDb(c.amount)) : null,
      submitted_at: c.created_at,
    });
  }

  items.sort((a, b) => {
    if (!a.submitted_at) return 1;
    if (!b.submitted_at) return -1;
    return b.submitted_at.localeCompare(a.submitted_at);
  });

  const total = items.length;
  return {
    total,
    items: items.slice(0, MAX_ITEMS),
    overflow: total > MAX_ITEMS,
  };
}

// ---------------------------------------------------------------------------
// my_projects
// ---------------------------------------------------------------------------

/**
 * Projects the caller is on, either as an assigned employee or a
 * PM. Uses the same JOIN pattern as the projects list page so the
 * "am I on this project?" question maps cleanly to the underlying
 * assignment tables.
 */
async function runMyProjects(ctx: ToolContext): Promise<{
  total: number;
  items: Array<{
    id: string;
    name: string;
    status: string;
    client_name: string | null;
    role_in_project: "PM" | "assigned";
  }>;
}> {
  const supabase = ctx.supabase;

  // PM assignments come first — "I'm running this project" is a
  // stronger relationship than being one of many assignees.
  const { data: pmRows } = await supabase
    .from("project_pm_assignments")
    .select(
      "project_id, status, projects:project_id (id, name, status, clients:client_id (name))",
    )
    .eq("pm_employee_id", ctx.employeeId)
    .eq("status", "ACTIVE");

  const { data: empRows } = await supabase
    .from("project_employee_assignments")
    .select(
      "project_id, status, projects:project_id (id, name, status, clients:client_id (name))",
    )
    .eq("employee_id", ctx.employeeId)
    .eq("status", "ACTIVE");

  const projectMap = new Map<
    string,
    {
      id: string;
      name: string;
      status: string;
      client_name: string | null;
      role_in_project: "PM" | "assigned";
    }
  >();

  const collect = (
    rows: Array<{
      project_id: string | null;
      projects: unknown;
    }>,
    role: "PM" | "assigned",
  ) => {
    for (const row of rows ?? []) {
      const proj = row.projects as
        | {
            id: string | null;
            name: string | null;
            status: string | null;
            clients: { name: string | null } | null;
          }
        | null;
      if (!proj?.id || !proj.name) continue;
      const existing = projectMap.get(proj.id);
      // PM wins over assigned if both apply.
      if (existing && existing.role_in_project === "PM") continue;
      projectMap.set(proj.id, {
        id: proj.id,
        name: proj.name,
        status: proj.status ?? "Unknown",
        client_name: proj.clients?.name ?? null,
        role_in_project: role,
      });
    }
  };

  collect((pmRows ?? []) as never, "PM");
  collect((empRows ?? []) as never, "assigned");

  const items = Array.from(projectMap.values());
  items.sort((a, b) => a.name.localeCompare(b.name));

  return { total: items.length, items: items.slice(0, MAX_ITEMS) };
}

// ---------------------------------------------------------------------------
// expense_summary_this_month
// ---------------------------------------------------------------------------

async function runExpenseSummary(ctx: ToolContext): Promise<{
  period: string;
  count: number;
  total_label: string;
  top_project: string | null;
  by_state: Record<string, number>;
}> {
  const supabase = ctx.supabase;

  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toISOString();

  // Restrict to expenses THE CALLER submitted. Same principle as
  // "my projects" — the tool is scoped to the individual, not the
  // tenant. A tenant admin who wants tenant-wide totals can visit
  // the reports page.
  const { data } = await supabase
    .from("project_expenses")
    .select(
      "id, amount, status, submitted_at, project_id, projects:project_id (name)",
    )
    .gte("submitted_at", start)
    .lt("submitted_at", end)
    .eq("submitter_employee_id", ctx.employeeId);

  let total = 0n;
  const byState: Record<string, number> = {};
  const byProject = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.amount != null) total += parseMoneyFromDb(row.amount);
    if (row.status) byState[row.status] = (byState[row.status] ?? 0) + 1;
    if (row.project_id) {
      const projectName =
        (row as unknown as { projects?: { name?: string } }).projects?.name ??
        row.project_id;
      byProject.set(projectName, (byProject.get(projectName) ?? 0) + 1);
    }
  }

  let topProject: string | null = null;
  let topCount = 0;
  for (const [name, count] of byProject.entries()) {
    if (count > topCount) {
      topProject = name;
      topCount = count;
    }
  }

  return {
    period: `${start.slice(0, 7)}`,
    count: data?.length ?? 0,
    total_label: formatIDR(total),
    top_project: topProject,
    by_state: byState,
  };
}

// ---------------------------------------------------------------------------
// my_timesheet_this_week
// ---------------------------------------------------------------------------

/**
 * ISO week start (Monday 00:00 in the tenant's timezone… well, UTC for
 * now — rules §18 will migrate helpers to `formatInTimeZone` later,
 * but the reporting window rounds to whole days so the DST edge cases
 * are OK for a summary tool). Ends at start of next Monday.
 */
function currentIsoWeekWindow(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const day = now.getUTCDay(); // 0..6, Sunday = 0
  const daysFromMonday = (day + 6) % 7; // Monday-anchored
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday),
  );
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  return {
    start: monday.toISOString().slice(0, 10),
    end: nextMonday.toISOString().slice(0, 10),
  };
}

async function runMyTimesheetThisWeek(ctx: ToolContext): Promise<{
  period: { start: string; end: string };
  total_hours: number;
  overtime_hours: number;
  by_project: Array<{ project_id: string | null; project_name: string; hours: number }>;
  entries_count: number;
  by_status: Record<string, number>;
}> {
  const supabase = ctx.supabase;
  const { start, end } = currentIsoWeekWindow();

  const { data } = await supabase
    .from("timesheets")
    .select(
      "hours_worked, hours_overtime, status, project_id, work_date, projects:project_id (name)",
    )
    .eq("employee_id", ctx.employeeId)
    .gte("work_date", start)
    .lt("work_date", end);

  let totalHours = 0;
  let overtimeHours = 0;
  const projectMap = new Map<
    string,
    { project_id: string | null; project_name: string; hours: number }
  >();
  const byStatus: Record<string, number> = {};

  for (const row of data ?? []) {
    const worked = Number(row.hours_worked ?? 0);
    const overtime = Number(row.hours_overtime ?? 0);
    totalHours += worked;
    overtimeHours += overtime;
    if (row.status) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

    const key = row.project_id ?? "__internal__";
    const projectName =
      (row as unknown as { projects?: { name?: string } | null }).projects?.name ??
      (row.project_id ? row.project_id : ctx.locale === "id" ? "Internal" : "Internal");
    const existing = projectMap.get(key);
    if (existing) {
      existing.hours += worked;
    } else {
      projectMap.set(key, {
        project_id: row.project_id ?? null,
        project_name: projectName,
        hours: worked,
      });
    }
  }

  const byProject = Array.from(projectMap.values())
    .sort((a, b) => b.hours - a.hours)
    .slice(0, MAX_ITEMS);

  return {
    period: { start, end },
    total_hours: round2(totalHours),
    overtime_hours: round2(overtimeHours),
    by_project: byProject.map((p) => ({ ...p, hours: round2(p.hours) })),
    entries_count: data?.length ?? 0,
    by_status: byStatus,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// my_direct_reports
// ---------------------------------------------------------------------------

async function runMyDirectReports(ctx: ToolContext): Promise<{
  total: number;
  items: Array<{
    id: string;
    full_name: string;
    role: string;
    is_active: boolean;
  }>;
  overflow: boolean;
}> {
  const supabase = ctx.supabase;
  const { data } = await supabase
    .from("employees")
    .select("id, full_name, role, is_active")
    .eq("reports_to_employee_id", ctx.employeeId)
    .order("full_name", { ascending: true })
    .limit(MAX_ITEMS + 1);

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    role: r.role,
    is_active: r.is_active ?? false,
  }));
  return {
    total: rows.length,
    items: rows.slice(0, MAX_ITEMS),
    overflow: rows.length > MAX_ITEMS,
  };
}

// ---------------------------------------------------------------------------
// pending_timesheets_to_approve
// ---------------------------------------------------------------------------

/**
 * Timesheets in status SUBMITTED that the caller can approve. Rules §12
 * says a timesheet is approved by "PM or Supervisor" (single-step).
 * Roles below can't approve — fast-return empty so the model doesn't
 * spend a DB call. RLS gives us the tenant scope; we further narrow
 * to the caller's *scope of visibility* by joining project_id against
 * their assignments — a PM only sees timesheets on their projects, a
 * Supervisor only sees their direct reports'.
 */
async function runPendingTimesheetsToApprove(ctx: ToolContext): Promise<{
  total: number;
  items: Array<{
    id: string;
    employee_name: string | null;
    work_date: string;
    hours_worked: number;
    project_name: string | null;
    submitted_at: string | null;
  }>;
  overflow: boolean;
}> {
  if (
    ctx.canonicalRole !== "PM" &&
    ctx.canonicalRole !== "SUPERVISOR" &&
    ctx.canonicalRole !== "ADMIN"
  ) {
    return { total: 0, items: [], overflow: false };
  }
  const supabase = ctx.supabase;

  // For PM: only timesheets on projects they own or are assigned to.
  // For SPV: only direct reports (reports_to_employee_id = ctx.employeeId).
  // Both narrowings happen with plain filters so we don't accidentally
  // widen the query if either scoping array is empty.
  let query = supabase
    .from("timesheets")
    .select(
      "id, work_date, hours_worked, submitted_at, project_id, employee_id, employees:employee_id (full_name), projects:project_id (name)",
    )
    .eq("status", "SUBMITTED")
    .order("submitted_at", { ascending: false })
    .limit(MAX_ITEMS + 1);

  if (ctx.canonicalRole === "PM") {
    const projectIds = await loadCallerProjectIds(ctx);
    if (projectIds.length === 0) {
      return { total: 0, items: [], overflow: false };
    }
    query = query.in("project_id", projectIds);
  } else if (ctx.canonicalRole === "SUPERVISOR") {
    const reportIds = await loadCallerDirectReportIds(ctx);
    if (reportIds.length === 0) {
      return { total: 0, items: [], overflow: false };
    }
    query = query.in("employee_id", reportIds);
  }
  // ADMIN sees all tenant-visible rows (RLS still applies).

  const { data } = await query;
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    employee_name:
      (r as unknown as { employees?: { full_name?: string } | null }).employees
        ?.full_name ?? null,
    work_date: r.work_date,
    hours_worked: Number(r.hours_worked ?? 0),
    project_name:
      (r as unknown as { projects?: { name?: string } | null }).projects?.name ??
      null,
    submitted_at: r.submitted_at,
  }));

  return {
    total: rows.length,
    items: rows.slice(0, MAX_ITEMS),
    overflow: rows.length > MAX_ITEMS,
  };
}

async function loadCallerProjectIds(ctx: ToolContext): Promise<string[]> {
  const supabase = ctx.supabase;
  const [pmRes, empRes] = await Promise.all([
    supabase
      .from("project_pm_assignments")
      .select("project_id")
      .eq("pm_employee_id", ctx.employeeId)
      .eq("status", "ACTIVE"),
    supabase
      .from("project_employee_assignments")
      .select("project_id")
      .eq("employee_id", ctx.employeeId)
      .eq("status", "ACTIVE"),
  ]);
  const set = new Set<string>();
  for (const r of pmRes.data ?? []) if (r.project_id) set.add(r.project_id);
  for (const r of empRes.data ?? []) if (r.project_id) set.add(r.project_id);
  return Array.from(set);
}

async function loadCallerDirectReportIds(ctx: ToolContext): Promise<string[]> {
  const { data } = await ctx.supabase
    .from("employees")
    .select("id")
    .eq("reports_to_employee_id", ctx.employeeId);
  return (data ?? []).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// project_status(project_id)
// ---------------------------------------------------------------------------

// Exported for the tools.test.ts guardrail suite — asserting Zod-level
// rejection is easier via the raw schema than via the AI-SDK-wrapped
// `tool.inputSchema`, which the SDK may transform internally.
export const projectIdInput = z.object({
  project_id: z.string().uuid(),
});

async function runProjectStatus(
  ctx: ToolContext,
  args: z.infer<typeof projectIdInput>,
): Promise<
  | { error: "not_assigned"; message: string }
  | {
      id: string;
      name: string;
      status: string;
      client_name: string | null;
      contract_value_label: string | null;
      spent_label: string;
      progress_pct: number | null;
      start_date: string | null;
      end_date: string | null;
    }
> {
  // Even though RLS scopes to the tenant, we additionally require that
  // the caller is on the project — otherwise the model could tell a
  // curious user about a project their teammates work on but they
  // don't. The scope model is per-user, not per-tenant.
  const callerProjects = await loadCallerProjectIds(ctx);
  const allowed = callerProjects.includes(args.project_id) ||
    ctx.canonicalRole === "ADMIN" ||
    ctx.canonicalRole === "DIRECTOR" ||
    ctx.canonicalRole === "FINANCE";
  if (!allowed) {
    return {
      error: "not_assigned",
      message:
        ctx.locale === "id"
          ? "Anda tidak terkait dengan proyek ini, jadi saya tidak bisa mengambil datanya."
          : "You aren't assigned to this project, so I can't fetch its data.",
    };
  }

  const supabase = ctx.supabase;
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, status, contract_value, start_date, end_date, progress, clients:client_id (name)",
    )
    .eq("id", args.project_id)
    .maybeSingle();
  if (!project) {
    return {
      error: "not_assigned",
      message:
        ctx.locale === "id"
          ? "Proyek tidak ditemukan."
          : "Project not found.",
    };
  }

  const { data: expenses } = await supabase
    .from("project_expenses")
    .select("amount, status")
    .eq("project_id", args.project_id)
    .eq("status", "APPROVED");
  let spent = 0n;
  for (const e of expenses ?? []) {
    if (e.amount != null) spent += parseMoneyFromDb(e.amount);
  }

  const contractValue =
    project.contract_value != null ? parseMoneyFromDb(project.contract_value) : null;

  return {
    id: project.id,
    name: project.name,
    status: project.status ?? "Unknown",
    client_name:
      (project as unknown as { clients?: { name?: string } | null }).clients?.name ??
      null,
    contract_value_label:
      contractValue != null ? formatIDR(contractValue) : null,
    spent_label: formatIDR(spent),
    progress_pct:
      project.progress != null ? Number(project.progress) : null,
    start_date: project.start_date ?? null,
    end_date: project.end_date ?? null,
  };
}

// ---------------------------------------------------------------------------
// budget_remaining(project_id)
// ---------------------------------------------------------------------------

async function runBudgetRemaining(
  ctx: ToolContext,
  args: z.infer<typeof projectIdInput>,
): Promise<
  | { error: "forbidden"; message: string }
  | { error: "not_assigned"; message: string }
  | {
      project_id: string;
      planned_label: string;
      approved_expense_label: string;
      remaining_label: string;
      utilization_pct: number;
      currency: string;
    }
> {
  const { canViewBudget } = await import("@/lib/rbac/roles");
  if (!canViewBudget(ctx.dbRole)) {
    return {
      error: "forbidden",
      message:
        ctx.locale === "id"
          ? "Peran Anda tidak memiliki akses melihat budget."
          : "Your role does not have access to budget information.",
    };
  }
  const callerProjects = await loadCallerProjectIds(ctx);
  const allowed = callerProjects.includes(args.project_id) ||
    ctx.canonicalRole === "ADMIN" ||
    ctx.canonicalRole === "DIRECTOR" ||
    ctx.canonicalRole === "FINANCE";
  if (!allowed) {
    return {
      error: "not_assigned",
      message:
        ctx.locale === "id"
          ? "Anda tidak terkait dengan proyek ini."
          : "You aren't assigned to this project.",
    };
  }

  const supabase = ctx.supabase;
  const { data: budgets } = await supabase
    .from("budgets")
    .select("total_planned_amount, currency, status")
    .eq("project_id", args.project_id)
    .eq("status", "APPROVED");

  let planned = 0n;
  let currency = "IDR";
  for (const b of budgets ?? []) {
    if (b.total_planned_amount != null) {
      planned += parseMoneyFromDb(b.total_planned_amount);
    }
    if (b.currency) currency = b.currency;
  }

  const { data: expenses } = await supabase
    .from("project_expenses")
    .select("amount, status")
    .eq("project_id", args.project_id)
    .eq("status", "APPROVED");
  let spent = 0n;
  for (const e of expenses ?? []) {
    if (e.amount != null) spent += parseMoneyFromDb(e.amount);
  }

  const remaining = planned - spent;
  const plannedNumber = Number(planned);
  const spentNumber = Number(spent);
  const utilization =
    plannedNumber > 0 ? round2((spentNumber / plannedNumber) * 100) : 0;

  return {
    project_id: args.project_id,
    planned_label: formatIDR(planned),
    approved_expense_label: formatIDR(spent),
    remaining_label: formatIDR(remaining),
    utilization_pct: utilization,
    currency,
  };
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

export type Level2Tool =
  | "list_pending_approvals"
  | "my_projects"
  | "expense_summary_this_month"
  | "my_timesheet_this_week"
  | "my_direct_reports"
  | "pending_timesheets_to_approve"
  | "project_status"
  | "budget_remaining";

export function makeToolRegistry(ctx: ToolContext) {
  const traces: ToolTrace[] = [];

  const wrapExecute = <T>(
    name: Level2Tool,
    args: Record<string, unknown>,
    handler: () => Promise<T>,
  ): Promise<T> => {
    const t0 = Date.now();
    return handler()
      .then((result) => {
        const preview = JSON.stringify(result).slice(0, 500);
        traces.push({
          name,
          arguments: args,
          result_preview: preview,
          duration_ms: Date.now() - t0,
          ok: true,
        });
        log.info("ai_tool_call", {
          tenant_id: ctx.tenantId,
          user_id: ctx.userId,
          tool: name,
          duration_ms: Date.now() - t0,
          ok: true,
        });
        return result;
      })
      .catch((err) => {
        traces.push({
          name,
          arguments: args,
          result_preview: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - t0,
          ok: false,
        });
        log.warn("ai_tool_call_failed", {
          tenant_id: ctx.tenantId,
          tool: name,
          error: err instanceof Error ? err.message : String(err),
        });
        // Return a structured error string so the model can surface
        // it to the user gracefully rather than 500-ing the stream.
        return {
          error: "tool_failed",
          message: "The tool encountered an error while running.",
        } as unknown as T;
      });
  };

  const tools = {
    list_pending_approvals: tool({
      description:
        ctx.locale === "id"
          ? "Ambil approval yang MENUNGGU TINDAKAN dari user saat ini (expense + cash advance). Kembalikan total + daftar (maks. 10). Panggil bila user bertanya 'ada approval yg harus saya lakukan?', 'apa yg saya blokir?', 'inbox saya', dll."
          : "Fetch approvals AWAITING THE CURRENT USER's action (expenses + cash advances). Returns total + up to 10 items. Call when the user asks 'what needs my attention', 'am I blocking anything', 'my inbox', etc.",
      inputSchema: listPendingApprovalsInput,
      execute: async () =>
        wrapExecute("list_pending_approvals", {}, () =>
          runListPendingApprovals(ctx),
        ),
    }),
    my_projects: tool({
      description:
        ctx.locale === "id"
          ? "Ambil daftar proyek dimana user saat ini terlibat (assigned employee ATAU PM). Kembalikan total + daftar (maks. 10). Panggil bila user bertanya 'proyek apa yg saya kerjakan', 'saya PM proyek mana', dst."
          : "Fetch projects the current user is on (assigned employee OR PM). Returns total + up to 10 items. Call when the user asks 'what projects am I on', 'which projects am I managing', etc.",
      inputSchema: z.object({}),
      execute: async () =>
        wrapExecute("my_projects", {}, () => runMyProjects(ctx)),
    }),
    expense_summary_this_month: tool({
      description:
        ctx.locale === "id"
          ? "Rekap expense yang DISUBMIT oleh user saat ini di bulan berjalan: total nominal, jumlah, proyek terbanyak, sebaran status. Panggil bila user bertanya 'total pengeluaran saya bulan ini', 'sudah berapa expense saya', dst."
          : "Summary of expenses SUBMITTED BY the current user this month: total, count, top project, by-state breakdown. Call when the user asks 'my expenses this month', 'how much have I spent', etc.",
      inputSchema: z.object({}),
      execute: async () =>
        wrapExecute("expense_summary_this_month", {}, () =>
          runExpenseSummary(ctx),
        ),
    }),
    my_timesheet_this_week: tool({
      description:
        ctx.locale === "id"
          ? "Rekap timesheet user saat ini di minggu berjalan (Senin-Minggu): total jam, jam lembur, jumlah entry, dan breakdown per proyek. Panggil bila user bertanya 'berapa jam saya minggu ini', 'sudah input timesheet apa saja', dst."
          : "Current-user's timesheet summary for this ISO week (Mon-Sun): total hours, overtime hours, entry count, per-project breakdown. Call for 'how many hours this week', 'my timesheet this week', etc.",
      inputSchema: z.object({}),
      execute: async () =>
        wrapExecute("my_timesheet_this_week", {}, () =>
          runMyTimesheetThisWeek(ctx),
        ),
    }),
    my_direct_reports: tool({
      description:
        ctx.locale === "id"
          ? "Daftar bawahan langsung user saat ini (employees.reports_to_employee_id = user). Kembalikan total + daftar (maks. 10). Panggil bila user bertanya 'siapa bawahan saya', 'siapa yang report ke saya', dst."
          : "The current user's direct reports (employees whose reports_to_employee_id equals the caller). Returns total + up to 10. Call for 'who reports to me', 'my team', etc.",
      inputSchema: z.object({}),
      execute: async () =>
        wrapExecute("my_direct_reports", {}, () => runMyDirectReports(ctx)),
    }),
    pending_timesheets_to_approve: tool({
      description:
        ctx.locale === "id"
          ? "Timesheet berstatus SUBMITTED yang menunggu approval user saat ini (khusus PM/Supervisor). PM lihat timesheet di proyeknya; Supervisor lihat dari direct reports-nya. Panggil bila user bertanya 'timesheet apa yang harus saya approve', 'approval timesheet saya', dst."
          : "Timesheets in SUBMITTED status awaiting the current user's approval (PM/Supervisor only). PM sees timesheets on their projects; Supervisor sees their direct reports'. Call for 'what timesheets should I approve', etc.",
      inputSchema: z.object({}),
      execute: async () =>
        wrapExecute("pending_timesheets_to_approve", {}, () =>
          runPendingTimesheetsToApprove(ctx),
        ),
    }),
    project_status: tool({
      description:
        ctx.locale === "id"
          ? "Ringkasan status satu proyek berdasarkan project_id (UUID). Kembalikan nama, status, klien, nilai kontrak, total expense APPROVED, dan progress. HANYA proyek dimana user terlibat (assigned atau PM). Peran ADMIN/DIRECTOR/FINANCE boleh membuka semua proyek dalam tenant."
          : "Status snapshot for a single project by project_id (UUID). Returns name, status, client, contract value, approved-expense total, and progress. ONLY projects the caller is on (assigned or PM). ADMIN/DIRECTOR/FINANCE roles may open any project in the tenant.",
      inputSchema: projectIdInput,
      execute: async (args) =>
        wrapExecute("project_status", args, () => runProjectStatus(ctx, args)),
    }),
    budget_remaining: tool({
      description:
        ctx.locale === "id"
          ? "Sisa budget proyek: total planned APPROVED - expense APPROVED. Termasuk % utilisasi. HANYA untuk role yang boleh lihat budget (PM/OM/FINANCE/DIRECTOR/ADMIN, cek canViewBudget). Employee/Supervisor akan menerima error 'forbidden'."
          : "Project budget remaining: APPROVED total_planned − APPROVED expenses. Includes utilisation %. ONLY for roles allowed to view budget (PM/OM/FINANCE/DIRECTOR/ADMIN, per canViewBudget). Employee/Supervisor get a 'forbidden' error.",
      inputSchema: projectIdInput,
      execute: async (args) =>
        wrapExecute("budget_remaining", args, () =>
          runBudgetRemaining(ctx, args),
        ),
    }),
  };

  return { tools, traces };
}

/** Small helper used by tests to build a partial context without importing supabase. */
export function makeToolContext(overrides: Partial<ToolContext> & {
  supabase: ToolContext["supabase"];
}): ToolContext {
  const dbRole: AnyDbEmployeeRole =
    overrides.dbRole ?? ("EMPLOYEE" as AnyDbEmployeeRole);
  return {
    tenantId: overrides.tenantId ?? "00000000-0000-0000-0000-000000000000",
    employeeId: overrides.employeeId ?? "00000000-0000-0000-0000-000000000000",
    userId: overrides.userId ?? "00000000-0000-0000-0000-000000000000",
    dbRole,
    canonicalRole:
      overrides.canonicalRole ?? toCanonicalRole(dbRole),
    locale: overrides.locale ?? "id",
    supabase: overrides.supabase,
  };
}
