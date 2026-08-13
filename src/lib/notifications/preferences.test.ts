import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Preferences data access layer tests.
 *
 * The critical invariant enforced here: `isChannelEnabled` MUST use
 * `createServiceRoleClient` (not `createClient`). Any regression that
 * flips it back to the session client silently fails-open for every
 * recipient that isn't the caller — approvers who opted OUT would
 * still receive emails/Telegram/WhatsApp because RLS returns 0 rows
 * for their preference lookup from a foreign session.
 *
 * Tenant isolation is verified by asserting the `.eq("tenant_id", …)`
 * filter is applied on every hot-path helper.
 */

vi.mock("server-only", () => ({}));

type MaybeSingleFn = () => Promise<{ data: unknown; error: null }>;

const serviceRoleMaybeSingle = vi.fn<MaybeSingleFn>();
const serviceRoleEq = vi.fn();
const serviceRoleClientFactory = vi.fn(() => ({
  from: (_table: string) => ({
    select: () => ({
      eq: serviceRoleEq,
    }),
  }),
}));

const sessionClientFactory = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => serviceRoleClientFactory(),
  createClient: async () => sessionClientFactory(),
}));

// Wire the chained .eq(...).eq(...).eq(...).eq(...).maybeSingle() shape.
// We use a builder closure so we can inspect the arguments passed.
function makeChainableEq() {
  const calls: Array<[string, unknown]> = [];
  const chain = {
    eq(col: string, val: unknown) {
      calls.push([col, val]);
      return chain;
    },
    maybeSingle: serviceRoleMaybeSingle,
    _calls: calls,
  };
  return chain;
}

beforeEach(() => {
  serviceRoleClientFactory.mockClear();
  sessionClientFactory.mockClear();
  serviceRoleMaybeSingle.mockReset();
  serviceRoleEq.mockReset();
  const chain = makeChainableEq();
  serviceRoleEq.mockImplementation((col: string, val: unknown) => {
    return chain.eq(col, val);
  });
});

describe("isChannelEnabled", () => {
  it("uses createServiceRoleClient (not the session client)", async () => {
    serviceRoleMaybeSingle.mockResolvedValueOnce({
      data: { enabled: true },
      error: null,
    });
    const { isChannelEnabled } = await import("./preferences");
    const result = await isChannelEnabled({
      tenantId: "t1",
      userId: "some-approver-not-me",
      category: "APPROVALS",
      channel: "EMAIL",
    });
    expect(result).toBe(true);
    expect(serviceRoleClientFactory).toHaveBeenCalled();
    expect(sessionClientFactory).not.toHaveBeenCalled();
  });

  it("fails open (returns true) when no preference row exists — matches original behaviour", async () => {
    serviceRoleMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { isChannelEnabled } = await import("./preferences");
    const result = await isChannelEnabled({
      tenantId: "t1",
      userId: "u1",
      category: "APPROVALS",
      channel: "EMAIL",
    });
    expect(result).toBe(true);
  });

  it("returns the enabled flag verbatim when a row exists (opt-out honoured)", async () => {
    serviceRoleMaybeSingle.mockResolvedValueOnce({
      data: { enabled: false },
      error: null,
    });
    const { isChannelEnabled } = await import("./preferences");
    const result = await isChannelEnabled({
      tenantId: "t1",
      userId: "u1",
      category: "APPROVALS",
      channel: "EMAIL",
    });
    // This is the actual bug we're guarding against — service role
    // must return `false` here, not fail-open. With the old session
    // client, a caller broadcasting to `u1` would silently get `true`
    // because RLS returns null (bug), then continue to email them
    // even though `u1` opted out.
    expect(result).toBe(false);
  });

  it("filters by tenant_id on every query — cross-tenant isolation invariant", async () => {
    serviceRoleMaybeSingle.mockResolvedValueOnce({
      data: { enabled: true },
      error: null,
    });
    const { isChannelEnabled } = await import("./preferences");
    await isChannelEnabled({
      tenantId: "tenant-alpha",
      userId: "u1",
      category: "APPROVALS",
      channel: "EMAIL",
    });
    // First .eq() call is the tenant_id filter — locks in the schema
    // contract. If a refactor drops this filter, this test fires first.
    const firstEqArgs = serviceRoleEq.mock.calls[0];
    expect(firstEqArgs?.[0]).toBe("tenant_id");
    expect(firstEqArgs?.[1]).toBe("tenant-alpha");
  });
});
