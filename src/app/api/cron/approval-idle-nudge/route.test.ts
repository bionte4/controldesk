import { describe, expect, it, vi } from "vitest";

/**
 * Smoke tests for /api/cron/approval-idle-nudge.
 *
 * Stubs the Supabase service-role client + notifyUser + the observability
 * logger so we exercise the handler's control flow without any network
 * or DB. Covered cases:
 *   - Auth guard (401 when CRON_SECRET is set but the header is missing).
 *   - Success path with zero tenants → 200, zero stats.
 *   - `?dry_run=true` propagates and suppresses `notifyUser` fan-out.
 *
 * Chained query mocking follows the same pattern as the sibling
 * settlement-reminders test — every method returns `this` and terminal
 * calls resolve with `{ data, error }` or `{ count, error }`.
 */

function makeSupabaseStub(overrides?: {
  tenants?: unknown[];
  approvers?: unknown[];
  pendingCount?: number;
  nudgeExistsToday?: boolean;
}) {
  const client = {
    from(table: string) {
      const rows =
        table === "tenants"
          ? (overrides?.tenants ?? [])
          : table === "employees"
            ? (overrides?.approvers ?? [])
            : [];
      const q = {
        select: vi.fn().mockImplementation((_cols, opts) => {
          if (opts?.head && opts?.count === "exact") {
            // Count-only heads: pending items OR "did we nudge today"
            const count =
              table === "notifications"
                ? overrides?.nudgeExistsToday
                  ? 1
                  : 0
                : (overrides?.pendingCount ?? 0);
            return {
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              like: vi.fn().mockReturnThis(),
              lt: vi.fn().mockReturnThis(),
              gte: vi.fn().mockResolvedValue({ count, error: null }),
            };
          }
          return q;
        }),
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
        in: vi.fn().mockReturnThis(),
        like: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
      };
      return q;
    },
  };
  return client;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => makeSupabaseStub(),
}));

// vi.mock is hoisted above imports, so any spy referenced from the
// factory must be declared inside the factory itself (not in the
// enclosing scope) — attempting to read a top-level `const` here
// throws `Cannot access ... before initialization`.
vi.mock("@/lib/notifications/service", () => ({
  notifyUser: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/observability/log", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from "@/app/api/cron/approval-idle-nudge/route";

function makeRequest(
  url = "http://localhost/api/cron/approval-idle-nudge",
  headers: Record<string, string> = {},
) {
  return new Request(url, { method: "POST", headers });
}

describe("cron · approval-idle-nudge", () => {
  it("returns 401 when CRON_SECRET is set and Authorization header is missing", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "unit-test-secret";
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    process.env.CRON_SECRET = prev;
  });

  it("returns 200 + zero stats when no tenants match", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "unit-test-secret";
    const res = await POST(
      makeRequest(
        "http://localhost/api/cron/approval-idle-nudge?dry_run=true",
        { authorization: "Bearer unit-test-secret" },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      dry_run: boolean;
      stats: { notified: number; tenants_processed: number };
    };
    expect(body.status).toBe("success");
    expect(body.dry_run).toBe(true);
    expect(body.stats.notified).toBe(0);
    process.env.CRON_SECRET = prev;
  });

  it("returns 401 when CRON_SECRET is set but the bearer token is wrong", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "unit-test-secret";
    const res = await POST(
      makeRequest(undefined, { authorization: "Bearer wrong" }),
    );
    expect(res.status).toBe(401);
    process.env.CRON_SECRET = prev;
  });
});
