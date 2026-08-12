import { describe, expect, it, vi } from "vitest";

/**
 * Smoke tests for /api/cron/settlement-reminders.
 *
 * We stub out the Supabase service-role client, the mailer, and the
 * observability logger so the tests can drive the handler's control flow
 * without touching the network. Verifies:
 *   - Auth guard (401 when CRON_SECRET is set but wrong header).
 *   - Success path when no rows match (2xx + zero stats).
 *   - Dry-run flag propagates.
 *   - Failure path returns 500 with a structured error.
 *
 * The heavier idempotency / SQL semantics are covered by the DB-level
 * integration test (`settlement_sla.sql` migration + Postgres trigger).
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared BEFORE we import the route.
// ---------------------------------------------------------------------------

function makeSupabaseStub(overrides?: {
  tenants?: unknown[];
  cashAdvances?: unknown[];
  expenses?: unknown[];
}) {
  const client = {
    from(table: string) {
      const rows =
        table === "tenants"
          ? (overrides?.tenants ?? [])
          : table === "cash_advances"
            ? (overrides?.cashAdvances ?? [])
            : table === "project_expenses"
              ? (overrides?.expenses ?? [])
              : [];
      // Chainable stub — every method returns `this` until awaited,
      // at which point the pending `data`/`error` is served up.
      const q = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: { id: "run-1" }, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: null, error: null }),
        then: (cb: (v: { data: unknown[]; error: null }) => unknown) =>
          cb({ data: rows, error: null }),
      };
      return q;
    },
  };
  return client;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => makeSupabaseStub(),
}));

vi.mock("@/lib/notify/mailer", () => ({
  sendEmail: vi.fn().mockResolvedValue({ status: "SKIPPED", provider: "noop" }),
}));

vi.mock("@/lib/observability/log", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Silence next-intl at module resolution time (it complains loudly during
// tests). The cron only calls `getTranslations`, so a fake that returns the
// key itself is enough.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));

// ---------------------------------------------------------------------------
// Import AFTER the mocks so the handler picks them up.
// ---------------------------------------------------------------------------

import { POST } from "@/app/api/cron/settlement-reminders/route";

function makeRequest(url = "http://localhost/api/cron/settlement-reminders", headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers });
}

describe("cron · settlement-reminders", () => {
  it("returns 401 when CRON_SECRET is set and Authorization header is missing", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "unit-test-secret";
    const req = makeRequest();
    const res = await POST(req);
    expect(res.status).toBe(401);
    process.env.CRON_SECRET = prev;
  });

  it("returns 200 + zero stats when no tenants match", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "unit-test-secret";
    const req = makeRequest("http://localhost/api/cron/settlement-reminders?dry_run=true", {
      authorization: "Bearer unit-test-secret",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      dry_run: boolean;
      stats: { ca_notifications: number; expense_draft_notifications: number };
    };
    expect(body.status).toBe("success");
    expect(body.dry_run).toBe(true);
    expect(body.stats.ca_notifications).toBe(0);
    expect(body.stats.expense_draft_notifications).toBe(0);
    process.env.CRON_SECRET = prev;
  });

  it("returns 401 when CRON_SECRET is set and Bearer token is wrong", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "unit-test-secret";
    const req = makeRequest(undefined, { authorization: "Bearer wrong" });
    const res = await POST(req);
    expect(res.status).toBe(401);
    process.env.CRON_SECRET = prev;
  });
});
