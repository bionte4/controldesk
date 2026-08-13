import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeToolContext, makeToolRegistry, projectIdInput } from "./index";

/**
 * Level 2 tool registry — safety-first tests.
 *
 * These tests focus on the properties the RFC 0001 threat model
 * cares about, not the raw plumbing:
 *   • Argument tampering — the model cannot smuggle a foreign
 *     tenant_id / user_id / project_id past our closure.
 *   • Closed-world tool set — the registry exposes ONLY the tools
 *     we listed. Adding a tool must be a deliberate code change,
 *     never accidental.
 *   • Failure isolation — a tool that throws must not blow up the
 *     whole request; the trace is captured, the error surfaces to
 *     the caller as a structured object.
 *
 * We stub the Supabase client with a chainable fake so the test
 * doesn't need a live DB — the tests here are about the REGISTRY,
 * not about Supabase query correctness (that has separate integration
 * coverage against the seeded local DB).
 */

type FakeQuery = {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function makeChainableStub(data: Array<Record<string, unknown>> = []) {
  const chain: FakeQuery = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  // Every builder method returns the chain except for the final
  // await point (limit / eq resolving to a `{ data, error }` shape).
  const chainable = new Proxy(chain, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          value(...args);
          return chainable;
        };
      }
      return value;
    },
  }) as unknown as FakeQuery & PromiseLike<{ data: unknown; error: null }>;

  // Terminal `then` — Supabase queries are thenables.
  (chainable as unknown as { then: unknown }).then = (
    resolve: (v: { data: unknown; error: null }) => unknown,
  ) => resolve({ data, error: null });

  return { chain, chainable };
}

let scopeCalls: string[] = [];
let filterArgs: Array<[string, unknown]> = [];

beforeEach(() => {
  scopeCalls = [];
  filterArgs = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const stubClient = () => {
  const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
    project_expenses: [],
    cash_advances: [],
    project_pm_assignments: [],
    project_employee_assignments: [],
    timesheets: [],
    employees: [],
    projects: [],
    budgets: [],
  };
  const client = {
    from: (table: string) => {
      scopeCalls.push(table);
      const { chainable } = makeChainableStub(rowsByTable[table] ?? []);
      // Track eq(...) calls so the "no tenant override" assertion can
      // read them back. We monkey-patch through the proxy by wrapping
      // the property access one more time.
      const wrapped = new Proxy(chainable, {
        get(target, prop) {
          const val = Reflect.get(target, prop);
          if (prop === "eq" && typeof val === "function") {
            return (col: string, value: unknown) => {
              filterArgs.push([col, value]);
              return val(col, value);
            };
          }
          if (prop === "in" && typeof val === "function") {
            return (col: string, values: unknown[]) => {
              filterArgs.push([col, values]);
              return val(col, values);
            };
          }
          return val;
        },
      });
      return wrapped;
    },
  } as unknown as ReturnType<typeof makeToolContext>["supabase"];
  return client;
};

describe("makeToolRegistry — Level 2 safety guardrails", () => {
  it("exposes exactly the eight whitelisted tools — no accidental extras", () => {
    const supabase = stubClient();
    const ctx = makeToolContext({ supabase });
    const { tools } = makeToolRegistry(ctx);
    expect(Object.keys(tools).sort()).toEqual(
      [
        "budget_remaining",
        "expense_summary_this_month",
        "list_pending_approvals",
        "my_direct_reports",
        "my_projects",
        "my_timesheet_this_week",
        "pending_timesheets_to_approve",
        "project_status",
      ].sort(),
    );
  });

  it("scopes every user-bound DB filter to the caller's employee_id — the model can't smuggle another user via arguments", async () => {
    const supabase = stubClient();
    const targetEmployeeId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const ctx = makeToolContext({
      supabase,
      employeeId: targetEmployeeId,
      tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      // PROJECT_MANAGER so `list_pending_approvals` returns a non-
      // empty status list — we want to exercise the widest possible
      // scope-filter surface.
      dbRole: "PROJECT_MANAGER",
    });
    const { tools } = makeToolRegistry(ctx);

    for (const tool of Object.values(tools)) {
      const execute = (tool as unknown as { execute: (input: unknown) => Promise<unknown> })
        .execute;
      await execute({});
    }

    // Every filter that's tied to a specific user must be the
    // caller's. We only assert on user-bound columns — the pending-
    // approval query filters by `status`, not user, since RLS scopes
    // it to tenant automatically.
    const userScopedCols = [
      "employee_id",
      "pm_employee_id",
      "submitter_employee_id",
      "requester_employee_id",
    ];
    const userFilters = filterArgs.filter(([col]) => userScopedCols.includes(col));
    // If there are user filters at all, they must ALL point at us.
    for (const [, value] of userFilters) {
      expect(value).toBe(targetEmployeeId);
    }
    // Additionally, no filter should mention a tenant id different from
    // ours (defensive — tools currently never pass tenant_id since
    // RLS enforces that, but a future refactor might).
    const tenantFilters = filterArgs.filter(([col]) => col === "tenant_id");
    for (const [, value] of tenantFilters) {
      expect(value).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    }
  });

  it("returns an empty result for employees who cannot approve anything (fast-path, no DB call)", async () => {
    const supabase = stubClient();
    const ctx = makeToolContext({
      supabase,
      dbRole: "EMPLOYEE", // plain EMPLOYEE has no approver slot
    });
    const { tools } = makeToolRegistry(ctx);
    const execute = (
      tools.list_pending_approvals as unknown as {
        execute: (input: unknown) => Promise<{ total: number }>;
      }
    ).execute;
    const result = await execute({});
    expect(result.total).toBe(0);
    // Fast path — no query to project_expenses/cash_advances.
    expect(scopeCalls).not.toContain("project_expenses");
    expect(scopeCalls).not.toContain("cash_advances");
  });

  it("touches only the whitelisted set of tables — no rogue reads", async () => {
    const supabase = stubClient();
    const ctx = makeToolContext({ supabase });
    const { tools } = makeToolRegistry(ctx);

    for (const tool of Object.values(tools)) {
      const execute = (tool as unknown as { execute: (input: unknown) => Promise<unknown> })
        .execute;
      await execute({});
    }

    const allowedTables = new Set([
      "project_expenses",
      "cash_advances",
      "project_pm_assignments",
      "project_employee_assignments",
      "timesheets",
      "employees",
      "projects",
      "budgets",
    ]);
    const unexpected = scopeCalls.filter((t) => !allowedTables.has(t));
    expect(unexpected).toEqual([]);
  });

  it("budget_remaining refuses to run for a role without canViewBudget()", async () => {
    const supabase = stubClient();
    const ctx = makeToolContext({
      supabase,
      dbRole: "EMPLOYEE",
    });
    const { tools } = makeToolRegistry(ctx);
    const budget = tools.budget_remaining as unknown as {
      execute: (input: unknown) => Promise<{ error?: string; message?: string }>;
    };
    const result = await budget.execute({
      project_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.error).toBe("forbidden");
    // Fast path — no budget read attempted when the role can't see it.
    expect(scopeCalls).not.toContain("budgets");
  });

  it("project_status refuses when the caller is not assigned to the project (non-admin roles)", async () => {
    const supabase = stubClient();
    const ctx = makeToolContext({
      supabase,
      dbRole: "EMPLOYEE",
      employeeId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    const { tools } = makeToolRegistry(ctx);
    const status = tools.project_status as unknown as {
      execute: (input: unknown) => Promise<{ error?: string; message?: string }>;
    };
    const result = await status.execute({
      project_id: "99999999-9999-9999-9999-999999999999",
    });
    expect(result.error).toBe("not_assigned");
  });

  it("pending_timesheets_to_approve fast-returns empty for roles that can't approve timesheets", async () => {
    const supabase = stubClient();
    const ctx = makeToolContext({
      supabase,
      dbRole: "EMPLOYEE",
    });
    const { tools } = makeToolRegistry(ctx);
    const pending = tools.pending_timesheets_to_approve as unknown as {
      execute: (input: unknown) => Promise<{ total: number; items: unknown[] }>;
    };
    const result = await pending.execute({});
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(scopeCalls).not.toContain("timesheets");
  });

  it("project_id-taking tools reject arguments that aren't UUIDs (schema-level)", () => {
    // Zod runs *before* our execute() sees the args (the AI SDK
    // validates model output against the tool's inputSchema first),
    // so a malformed UUID never reaches the query builder.
    expect(projectIdInput.safeParse({ project_id: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(projectIdInput.safeParse({}).success).toBe(false);
    // Proper UUIDv4 with the version+variant bits Zod expects.
    expect(
      projectIdInput.safeParse({
        project_id: "11111111-1111-4111-9111-111111111111",
      }).success,
    ).toBe(true);
  });

  it("captures a trace entry per tool call for audit", async () => {
    const supabase = stubClient();
    const ctx = makeToolContext({ supabase });
    const { tools, traces } = makeToolRegistry(ctx);

    const listApprovals = tools.list_pending_approvals as unknown as {
      execute: (input: unknown) => Promise<unknown>;
    };
    await listApprovals.execute({});

    expect(traces).toHaveLength(1);
    expect(traces[0]!.name).toBe("list_pending_approvals");
    expect(traces[0]!.ok).toBe(true);
    expect(traces[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns a structured error object when a tool throws — the whole request must not 500", async () => {
    const badClient = {
      from: () => {
        throw new Error("simulated db outage");
      },
    } as unknown as ReturnType<typeof makeToolContext>["supabase"];
    const ctx = makeToolContext({ supabase: badClient });
    const { tools, traces } = makeToolRegistry(ctx);

    const myProjects = tools.my_projects as unknown as {
      execute: (input: unknown) => Promise<unknown>;
    };
    const result = (await myProjects.execute({})) as {
      error?: string;
      message?: string;
    };
    expect(result.error).toBe("tool_failed");
    expect(traces).toHaveLength(1);
    expect(traces[0]!.ok).toBe(false);
  });
});
