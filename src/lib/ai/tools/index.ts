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
function statusesAwaiting(
  role: CanonicalRole,
): {
  expense: readonly string[];
  ca: readonly string[];
} {
  // Two schemas exist because CA got the canonical rename first
  // (PENDING_SUPERVISOR, etc.) — expense still uses the legacy
  // Lnnn names.
  switch (role) {
    case "SUPERVISOR":
      return {
        expense: ["PENDING_L1_SUPERVISOR"],
        ca: ["PENDING_L1_SUPERVISOR", "PENDING_SUPERVISOR"],
      };
    case "PROJECT_MANAGER":
      return {
        expense: ["PENDING_L2_PROJECT_MANAGER"],
        ca: ["PENDING_L2_PROJECT_MANAGER", "PENDING_PM"],
      };
    case "LEAD_FINANCE":
      return {
        expense: ["PENDING_L2_5_FINANCE"],
        ca: ["PENDING_L2_5_FINANCE", "PENDING_FINANCE"],
      };
    case "OPERATIONS_MANAGER":
      return {
        expense: ["PENDING_L3_OPERATIONS_MANAGER"],
        ca: ["PENDING_L3_OPERATIONS_MANAGER", "PENDING_OM"],
      };
    case "HEAD_MANAGER":
      return {
        expense: ["PENDING_L4_HEAD_MANAGER"],
        ca: ["PENDING_L4_HEAD_MANAGER"],
      };
    case "GENERAL_MANAGER":
    case "TENANT_ADMIN":
      return {
        expense: ["PENDING_L5_GENERAL_MANAGER"],
        ca: ["PENDING_L5_GENERAL_MANAGER", "PENDING_DIRECTOR"],
      };
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
// Registry factory
// ---------------------------------------------------------------------------

export type Level2Tool =
  | "list_pending_approvals"
  | "my_projects"
  | "expense_summary_this_month";

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
