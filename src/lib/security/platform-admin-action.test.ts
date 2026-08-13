/**
 * Unit tests for `withPlatformAdminAction`. Mirrors the contract
 * coverage in `action-wrapper.test.ts`, but for the cross-tenant
 * super-admin gate (no PDP / no tenant RLS — service-role + platform
 * admin identity).
 *
 * Rules §21: this file was 0% covered and dragged
 * `src/lib/security/**` below the 80% merge floor.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const rpcMock = vi.fn();
const insertMock = vi.fn();

vi.mock("@/lib/auth/platform-admin-session", () => ({
  getCurrentPlatformAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(() => ({
    rpc: rpcMock,
    from: () => ({ insert: insertMock }),
  })),
}));
vi.mock("@/lib/observability/log", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getCurrentPlatformAdmin } from "@/lib/auth/platform-admin-session";
import { log } from "@/lib/observability/log";
import { withPlatformAdminAction } from "./platform-admin-action";

const ADMIN = {
  user_id: "pa-user-1",
  email: "ops@controldesk.test",
  full_name: "Platform Ops",
  created_at: "2026-01-01T00:00:00.000Z",
};

const schema = z.object({ slug: z.string().min(1) });

function makeAction(
  handler: Parameters<
    typeof withPlatformAdminAction<typeof schema, { id: string }>
  >[0]["handler"],
) {
  return withPlatformAdminAction({
    schema,
    auditAction: "CREATE",
    resourceName: "tenants",
    handler,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentPlatformAdmin).mockResolvedValue(ADMIN);
  rpcMock.mockResolvedValue({ error: null });
  insertMock.mockResolvedValue({ error: null });
});

describe("withPlatformAdminAction", () => {
  it("returns UNAUTHENTICATED when no platform admin session", async () => {
    vi.mocked(getCurrentPlatformAdmin).mockResolvedValueOnce(null);
    const handler = vi.fn();
    const action = makeAction(handler);

    const res = await action({ slug: "acme" });

    expect(res).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
      reason: "Not signed in as a platform admin.",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns VALIDATION with joined issue paths on bad input", async () => {
    const handler = vi.fn();
    const action = makeAction(handler);

    const res = await action({ slug: "" });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected validation failure");
    expect(res.code).toBe("VALIDATION");
    expect(res.reason).toContain("slug:");
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs handler + audit RPC on the happy path", async () => {
    const handler = vi.fn(async () => ({
      result: { id: "tenant-1" },
      auditResourceId: "tenant-1",
      auditTargetTenantId: "tenant-1",
      auditOldValues: null,
      auditNewValues: { slug: "acme" },
      auditMetadata: { source: "test" },
    }));
    const action = makeAction(handler);

    const res = await action({ slug: "acme" });

    expect(res).toEqual({ ok: true, data: { id: "tenant-1" } });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      { slug: "acme" },
      expect.objectContaining({
        admin: {
          user_id: ADMIN.user_id,
          email: ADMIN.email,
          full_name: ADMIN.full_name,
        },
      }),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "record_platform_admin_audit",
      expect.objectContaining({
        p_action_type: "CREATE",
        p_resource_name: "tenants",
        p_resource_id: "tenant-1",
        p_target_tenant: "tenant-1",
        p_metadata: expect.objectContaining({
          source: "test",
          actor_user_id: ADMIN.user_id,
          actor_email: ADMIN.email,
        }),
      }),
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("omits optional audit ids when the snapshot leaves them unset", async () => {
    const action = makeAction(async () => ({ result: { id: "x" } }));

    const res = await action({ slug: "acme" });

    expect(res).toEqual({ ok: true, data: { id: "x" } });
    expect(rpcMock).toHaveBeenCalledWith(
      "record_platform_admin_audit",
      expect.objectContaining({
        p_resource_id: undefined,
        p_target_tenant: undefined,
        p_old_values: undefined,
        p_new_values: undefined,
      }),
    );
  });

  it("returns INTERNAL when the handler throws an Error", async () => {
    const action = makeAction(async () => {
      throw new Error("provision exploded");
    });

    const res = await action({ slug: "acme" });

    expect(res).toEqual({
      ok: false,
      code: "INTERNAL",
      reason: "provision exploded",
    });
    expect(log.error).toHaveBeenCalledWith(
      "platform admin action failed",
      expect.objectContaining({
        action: "CREATE",
        resource: "tenants",
        actor: ADMIN.user_id,
        error: "provision exploded",
      }),
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("stringifies non-Error handler throws", async () => {
    const action = makeAction(async () => {
      throw "boom-string";
    });

    const res = await action({ slug: "acme" });

    expect(res).toEqual({
      ok: false,
      code: "INTERNAL",
      reason: "boom-string",
    });
  });

  it("falls back to a direct insert when the audit RPC fails, still returning ok", async () => {
    rpcMock.mockResolvedValueOnce({
      error: { message: "rpc denied" },
    });
    const action = makeAction(async () => ({
      result: { id: "tenant-2" },
      auditResourceId: "tenant-2",
      auditTargetTenantId: "tenant-2",
      auditOldValues: { status: "trial" },
      auditNewValues: { status: "active" },
      auditMetadata: { via: "rpc-fail" },
    }));

    const res = await action({ slug: "acme" });

    expect(res).toEqual({ ok: true, data: { id: "tenant-2" } });
    expect(log.error).toHaveBeenCalledWith(
      "platform admin audit write failed",
      expect.objectContaining({
        error: "rpc denied",
        action: "CREATE",
        resource: "tenants",
      }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: ADMIN.user_id,
        actor_email: ADMIN.email,
        action_type: "CREATE",
        resource_name: "tenants",
        resource_id: "tenant-2",
        target_tenant_id: "tenant-2",
        metadata: expect.objectContaining({
          via: "rpc-fail",
          audit_rpc_error: "rpc denied",
          fallback_direct_insert: true,
        }),
      }),
    );
  });

  it("still returns ok when the audit fallback insert also throws", async () => {
    rpcMock.mockResolvedValueOnce({
      error: { message: "rpc denied" },
    });
    insertMock.mockRejectedValueOnce(new Error("insert denied"));
    const action = makeAction(async () => ({ result: { id: "tenant-3" } }));

    const res = await action({ slug: "acme" });

    expect(res).toEqual({ ok: true, data: { id: "tenant-3" } });
    expect(log.error).toHaveBeenCalledWith(
      "platform admin audit fallback insert also failed",
      expect.objectContaining({ error: "insert denied" }),
    );
  });

  it("stringifies non-Error fallback insert failures", async () => {
    rpcMock.mockResolvedValueOnce({
      error: { message: "rpc denied" },
    });
    insertMock.mockRejectedValueOnce("insert-string");
    const action = makeAction(async () => ({ result: { id: "tenant-4" } }));

    const res = await action({ slug: "acme" });

    expect(res.ok).toBe(true);
    expect(log.error).toHaveBeenCalledWith(
      "platform admin audit fallback insert also failed",
      expect.objectContaining({ error: "insert-string" }),
    );
  });
});
