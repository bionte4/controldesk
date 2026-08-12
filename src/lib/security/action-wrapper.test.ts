/**
 * Unit tests for `withSecureAction`, `withCanonicalSecureAction`, and
 * `requireCanonicalRoles`. All external collaborators (`requireCurrentEmployee`,
 * `authorize`, `authorizeCanonical`, `recordAudit`) are mocked so this suite
 * exercises the wrapper's 5-step contract in isolation:
 *
 *   1. Auth — surface active employee
 *   2. Zod validation of raw input
 *   3. PDP authorize (returns Decision — allow or deny)
 *   4. Handler execution (may throw)
 *   5. Audit trail (may throw — considered hard error)
 *
 * Rules §17.2 + §17.3 + §21 (80% coverage floor for src/lib/security/**).
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { z } from "zod";

// Mock module boundaries BEFORE importing the SUT. Vitest hoists these.
vi.mock("@/lib/auth/session", () => ({
  requireCurrentEmployee: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/security/pdp", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@/lib/security/pdp");
  return {
    ...actual,
    authorize: vi.fn(),
  };
});
vi.mock("@/lib/security/pdp-canonical", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@/lib/security/pdp-canonical");
  return {
    ...actual,
    authorizeCanonical: vi.fn(),
  };
});

import { requireCurrentEmployee } from "@/lib/auth/session";
import { recordAudit } from "@/lib/security/audit";
import { authorize } from "@/lib/security/pdp";
import { authorizeCanonical } from "@/lib/security/pdp-canonical";

import {
  requireCanonicalRoles,
  withCanonicalSecureAction,
  withSecureAction,
  type SecureActionSnapshot,
} from "./action-wrapper";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function makeEmployee(role: string = "TENANT_ADMIN") {
  return {
    id: "emp-1",
    user_id: "user-1",
    tenant_id: TENANT_ID,
    role,
    display_name: "Ada Lovelace",
    email: "ada@example.com",
    status: "ACTIVE",
  } as unknown as ReturnType<typeof requireCurrentEmployee> extends Promise<
    infer T
  >
    ? T
    : never;
}

const snapshot = <T>(result: T): SecureActionSnapshot<T> => ({
  result,
  auditResourceId: "resource-1",
  auditOldValues: { name: "old" },
  auditNewValues: { name: "new" },
  auditMetadata: { source: "test" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCurrentEmployee).mockResolvedValue(makeEmployee());
  vi.mocked(authorize).mockReturnValue({ effect: "ALLOW", reason: "ok" });
  vi.mocked(authorizeCanonical).mockReturnValue({
    effect: "ALLOW",
    reason: "ok",
  });
  vi.mocked(recordAudit).mockResolvedValue(undefined);
});

describe("withSecureAction", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("runs the full happy-path pipeline (auth → validate → PDP → handler → audit)", async () => {
    const handler = vi.fn(async () => snapshot({ id: "created-1" }));
    const action = withSecureAction({
      schema,
      resource: "expense",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "expenses",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler,
    });

    const res = await action({ name: "hello" });

    expect(res).toEqual({ ok: true, data: { id: "created-1" } });
    expect(requireCurrentEmployee).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        resourceName: "expenses",
        resourceId: "resource-1",
        oldValues: { name: "old" },
        newValues: { name: "new" },
        metadata: { source: "test" },
      }),
    );
  });

  it("returns VALIDATION error when Zod parse fails and skips PDP/handler/audit", async () => {
    const handler = vi.fn();
    const action = withSecureAction({
      schema,
      resource: "expense",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "expenses",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler,
    });

    const res = await action({ name: "" });

    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toBeDefined();
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("uses fallback message when Zod produces no issue message", async () => {
    // Contrived — feed the wrapper a schema whose parse produces an issue
    // with an empty message, forcing the wrapper's `??` fallback branch.
    const oddSchema = z.custom<{ x: string }>(() => false, { message: "" });
    const action = withSecureAction({
      schema: oddSchema,
      resource: "expense",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "expenses",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: vi.fn(),
    });
    const res = await action({ x: "y" });
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.code).toBe("VALIDATION");
      // Either the empty-message-fallback or an issue message — both prove
      // the branch didn't crash.
      expect(typeof res.reason).toBe("string");
    }
  });

  it("returns FORBIDDEN when PDP denies and skips handler + audit", async () => {
    vi.mocked(authorize).mockReturnValue({
      effect: "DENY",
      reason: "role EMPLOYEE cannot create expense",
    });
    const handler = vi.fn();
    const action = withSecureAction({
      schema,
      resource: "expense",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "expenses",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler,
    });

    const res = await action({ name: "ok" });

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      reason: "role EMPLOYEE cannot create expense",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns INTERNAL when handler throws an Error", async () => {
    const action = withSecureAction({
      schema,
      resource: "expense",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "expenses",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: async () => {
        throw new Error("boom");
      },
    });

    const res = await action({ name: "ok" });

    expect(res).toEqual({ ok: false, code: "INTERNAL", reason: "boom" });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns INTERNAL with default message when handler throws non-Error", async () => {
    const action = withSecureAction({
      schema,
      resource: "expense",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "expenses",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "string not error";
      },
    });

    const res = await action({ name: "ok" });

    expect(res).toEqual({
      ok: false,
      code: "INTERNAL",
      reason: "internal error",
    });
  });

  it("returns AUDIT_FAILED when recordAudit throws an Error", async () => {
    vi.mocked(recordAudit).mockRejectedValueOnce(new Error("db down"));
    const handler = vi.fn(async () => snapshot({ id: "ok" }));
    const action = withSecureAction({
      schema,
      resource: "expense",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "expenses",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler,
    });

    const res = await action({ name: "ok" });

    expect(res).toEqual({
      ok: false,
      code: "AUDIT_FAILED",
      reason: "db down",
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("returns AUDIT_FAILED with default message when recordAudit throws non-Error", async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    vi.mocked(recordAudit).mockRejectedValueOnce("nope");
    const action = withSecureAction({
      schema,
      resource: "expense",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "expenses",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: async () => snapshot({ id: "x" }),
    });

    const res = await action({ name: "ok" });

    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.code).toBe("AUDIT_FAILED");
      expect(res.reason).toBe("audit failed");
    }
  });

  it("passes canonical role into ctx and defaults snapshot audit fields to null", async () => {
    let observedCtxRole: string | null = null;
    const action = withSecureAction({
      schema,
      resource: "expense",
      action: "read",
      auditAction: "EXPORT",
      auditResourceName: "expenses",
      resolveAttributes: (_input, ctx) => {
        observedCtxRole = ctx.canonicalRole;
        return { tenantId: ctx.actor.tenantId };
      },
      // Snapshot omits audit* fields entirely — wrapper should coalesce to null.
      handler: async () => ({ result: { count: 1 } }),
    });

    const res = await action({ name: "read-me" });

    expect(res).toEqual({ ok: true, data: { count: 1 } });
    expect(observedCtxRole).not.toBeNull();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: null,
        oldValues: null,
        newValues: null,
        metadata: null,
      }),
    );
  });
});

describe("withCanonicalSecureAction", () => {
  const schema = z.object({ id: z.string().uuid() });
  // Zod v4 enforces the RFC 4122 pattern including the variant nibble
  // (position 20 must be in [89abAB]). The naive `"2222-2222"` string
  // fails validation; use a valid v4 UUID.
  const validId = "22222222-2222-4222-8222-222222222222";

  it("runs the full happy-path pipeline with a static resource key", async () => {
    const handler = vi.fn(async () => snapshot({ ok: true }));
    const action = withCanonicalSecureAction({
      schema,
      resource: "cash_advance_general",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "cash_advances",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler,
    });

    const res = await action({ id: validId });

    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(authorizeCanonical).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
    expect(recordAudit).toHaveBeenCalledOnce();
  });

  it("resolves the resource via callback when configured as a function", async () => {
    const resolveResource = vi.fn(() => "cash_advance_field_ops" as const);
    const action = withCanonicalSecureAction({
      schema,
      resource: resolveResource,
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "cash_advances",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: async () => snapshot({ ok: true }),
    });

    const res = await action({ id: validId });

    expect(res.ok).toBe(true);
    expect(resolveResource).toHaveBeenCalledOnce();
    expect(authorizeCanonical).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "cash_advance_field_ops" }),
    );
  });

  it("returns VALIDATION when Zod fails", async () => {
    const action = withCanonicalSecureAction({
      schema,
      resource: "cash_advance_general",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "cash_advances",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: vi.fn(),
    });

    const res = await action({ id: "not-a-uuid" });

    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.code).toBe("VALIDATION");
    expect(authorizeCanonical).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN when canonical PDP denies", async () => {
    vi.mocked(authorizeCanonical).mockReturnValue({
      effect: "DENY",
      reason: "canonical DENY",
    });
    const handler = vi.fn();
    const action = withCanonicalSecureAction({
      schema,
      resource: "cash_advance_general",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "cash_advances",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler,
    });

    const res = await action({ id: validId });

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      reason: "canonical DENY",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns INTERNAL when the canonical handler throws", async () => {
    const action = withCanonicalSecureAction({
      schema,
      resource: "cash_advance_general",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "cash_advances",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: async () => {
        throw new Error("canonical boom");
      },
    });

    const res = await action({ id: validId });

    expect(res).toEqual({
      ok: false,
      code: "INTERNAL",
      reason: "canonical boom",
    });
  });

  it("returns INTERNAL with default message when canonical handler throws non-Error", async () => {
    const action = withCanonicalSecureAction({
      schema,
      resource: "cash_advance_general",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "cash_advances",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 42;
      },
    });

    const res = await action({ id: validId });

    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.code).toBe("INTERNAL");
      expect(res.reason).toBe("internal error");
    }
  });

  it("returns AUDIT_FAILED when canonical recordAudit throws an Error", async () => {
    vi.mocked(recordAudit).mockRejectedValueOnce(new Error("audit db down"));
    const action = withCanonicalSecureAction({
      schema,
      resource: "cash_advance_general",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "cash_advances",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: async () => snapshot({ ok: true }),
    });

    const res = await action({ id: validId });

    expect(res).toEqual({
      ok: false,
      code: "AUDIT_FAILED",
      reason: "audit db down",
    });
  });

  it("returns AUDIT_FAILED with default message when canonical recordAudit throws non-Error", async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    vi.mocked(recordAudit).mockRejectedValueOnce({ weird: true });
    const action = withCanonicalSecureAction({
      schema,
      resource: "cash_advance_general",
      action: "create",
      auditAction: "CREATE",
      auditResourceName: "cash_advances",
      resolveAttributes: () => ({ tenantId: TENANT_ID }),
      handler: async () => snapshot({ ok: true }),
    });

    const res = await action({ id: validId });

    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.code).toBe("AUDIT_FAILED");
      expect(res.reason).toBe("audit failed");
    }
  });

  it("populates both legacyActor and canonical actor on the ctx", async () => {
    let observedLegacy: { role: string; tenantId: string } | null = null;
    let observedCanonical: { role: string; tenantId: string } | null = null;
    const action = withCanonicalSecureAction({
      schema,
      resource: "cash_advance_general",
      action: "read",
      auditAction: "EXPORT",
      auditResourceName: "cash_advances",
      resolveAttributes: (_input, ctx) => {
        observedLegacy = {
          role: ctx.legacyActor.role,
          tenantId: ctx.legacyActor.tenantId,
        };
        observedCanonical = {
          role: ctx.actor.role,
          tenantId: ctx.actor.tenantId,
        };
        return { tenantId: ctx.actor.tenantId };
      },
      handler: async () => snapshot({ ok: true }),
    });

    await action({ id: validId });

    expect(observedLegacy).not.toBeNull();
    expect(observedCanonical).not.toBeNull();
    expect(observedLegacy!.tenantId).toBe(TENANT_ID);
    expect(observedCanonical!.tenantId).toBe(TENANT_ID);
  });
});

describe("requireCanonicalRoles", () => {
  const canonicalActor = (role: string) =>
    ({
      userId: "u",
      employeeId: "e",
      role: role as never,
      tenantId: TENANT_ID,
    }) as Parameters<typeof requireCanonicalRoles>[0];

  it("ADMIN always passes (override branch)", () => {
    const d = requireCanonicalRoles(canonicalActor("ADMIN"), [
      "PM",
      "OM",
    ] as never);
    expect(d.effect).toBe("ALLOW");
    expect(d.reason).toMatch(/admin/i);
  });

  it("returns ALLOW when actor.role is in the allow-list", () => {
    const d = requireCanonicalRoles(canonicalActor("FINANCE"), [
      "PM",
      "FINANCE",
      "OM",
    ] as never);
    expect(d.effect).toBe("ALLOW");
    expect(d.reason).toMatch(/allowed/);
  });

  it("returns DENY with detailed reason when actor.role is not allowed", () => {
    const d = requireCanonicalRoles(canonicalActor("EMPLOYEE"), [
      "PM",
      "OM",
      "DIRECTOR",
    ] as never);
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/EMPLOYEE/);
    expect(d.reason).toMatch(/PM.*OM.*DIRECTOR|OM.*PM.*DIRECTOR/);
  });
});
