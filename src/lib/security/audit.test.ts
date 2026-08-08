/**
 * Unit tests for `recordAudit()` in `src/lib/security/audit.ts`.
 *
 * Coverage focus (rules §3 + §21):
 *   1. Sensitive-key redaction across scalar / nested / array payloads.
 *   2. IP header fallback chain (x-forwarded-for → x-real-ip → cf-connecting-ip).
 *   3. Supabase RPC error surfaces as a thrown Error.
 *   4. `headers()` throws → silently degrades to null IP/UA (RSC context guard).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const headersGetMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
  })),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: headersGetMock })),
}));

import { headers as headersMock } from "next/headers";
import { recordAudit } from "./audit";

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ error: null });
  headersGetMock.mockReset();
  headersGetMock.mockImplementation((name: string) => {
    switch (name) {
      case "x-forwarded-for":
        return "203.0.113.9, 10.0.0.1";
      case "user-agent":
        return "vitest/1.0";
      default:
        return null;
    }
  });
  vi.mocked(headersMock).mockImplementation(
    async () =>
      ({
        get: headersGetMock,
      }) as unknown as ReturnType<typeof headersMock> extends Promise<infer T>
        ? T
        : never,
  );
});

describe("recordAudit — request context extraction", () => {
  it("picks the first hop from x-forwarded-for as the IP", async () => {
    await recordAudit({
      actionType: "CREATE",
      resourceName: "expenses",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "record_audit_log",
      expect.objectContaining({
        p_ip_address: "203.0.113.9",
        p_user_agent: "vitest/1.0",
      }),
    );
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    headersGetMock.mockImplementation((name: string) =>
      name === "x-real-ip"
        ? "198.51.100.42"
        : name === "user-agent"
          ? "curl/8"
          : null,
    );
    await recordAudit({
      actionType: "CREATE",
      resourceName: "expenses",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "record_audit_log",
      expect.objectContaining({ p_ip_address: "198.51.100.42" }),
    );
  });

  it("falls back to cf-connecting-ip when the other two are absent", async () => {
    headersGetMock.mockImplementation((name: string) =>
      name === "cf-connecting-ip" ? "192.0.2.7" : null,
    );
    await recordAudit({
      actionType: "CREATE",
      resourceName: "expenses",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "record_audit_log",
      expect.objectContaining({ p_ip_address: "192.0.2.7" }),
    );
  });

  it("returns null IP/UA when no proxy header is present", async () => {
    headersGetMock.mockImplementation(() => null);
    await recordAudit({
      actionType: "CREATE",
      resourceName: "expenses",
    });
    // Both p_ip_address and p_user_agent should be `undefined` — the wrapper
    // uses `?? undefined` so the Postgres function gets NULL.
    expect(rpcMock).toHaveBeenCalledWith(
      "record_audit_log",
      expect.objectContaining({
        p_ip_address: undefined,
        p_user_agent: undefined,
      }),
    );
  });

  it("silently degrades to null IP/UA when headers() throws (non-RSC caller)", async () => {
    vi.mocked(headersMock).mockRejectedValueOnce(
      new Error("headers() not allowed here") as never,
    );
    await recordAudit({
      actionType: "CREATE",
      resourceName: "expenses",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "record_audit_log",
      expect.objectContaining({
        p_ip_address: undefined,
        p_user_agent: undefined,
      }),
    );
  });
});

describe("recordAudit — redaction", () => {
  it("redacts top-level sensitive scalar keys", async () => {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "employees",
      oldValues: {
        salary: 15000000,
        display_name: "Ada",
        bank_account_number: "12345-6789",
      },
    });
    const call = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    const oldValues = call["p_old_values"] as Record<string, unknown>;
    expect(oldValues.salary).toBe("[REDACTED]");
    expect(oldValues.bank_account_number).toBe("[REDACTED]");
    expect(oldValues.display_name).toBe("Ada");
  });

  it("redacts sensitive keys nested inside objects (case-insensitive)", async () => {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "employees",
      newValues: {
        profile: {
          Bank_Account: "abc",
          address: "Jl. Sudirman",
        },
      },
    });
    const call = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    const newValues = call["p_new_values"] as {
      profile: { Bank_Account: string; address: string };
    };
    expect(newValues.profile.Bank_Account).toBe("[REDACTED]");
    expect(newValues.profile.address).toBe("Jl. Sudirman");
  });

  it("recurses into arrays and redacts sensitive keys inside array items", async () => {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "employees",
      newValues: {
        keys: [
          { api_key: "sk-live-123", label: "prod" },
          { api_key: "sk-live-456", label: "staging" },
        ],
      },
    });
    const call = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    const newValues = call["p_new_values"] as {
      keys: { api_key: string; label: string }[];
    };
    expect(newValues.keys[0]!.api_key).toBe("[REDACTED]");
    expect(newValues.keys[0]!.label).toBe("prod");
    expect(newValues.keys[1]!.api_key).toBe("[REDACTED]");
  });

  it("passes null and undefined through untouched", async () => {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "employees",
      newValues: {
        email: null,
        phone: undefined,
        nickname: "ada",
      },
    });
    const call = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    const newValues = call["p_new_values"] as Record<string, unknown>;
    expect(newValues.email).toBeNull();
    // undefined → null after JSON coercion or preserved as null
    expect(newValues.phone).toBeNull();
    expect(newValues.nickname).toBe("ada");
  });

  it("preserves scalars (string, number, boolean) as-is", async () => {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "employees",
      newValues: {
        name: "Ada",
        age: 42,
        is_active: true,
      },
    });
    const call = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    const newValues = call["p_new_values"] as Record<string, unknown>;
    expect(newValues.name).toBe("Ada");
    expect(newValues.age).toBe(42);
    expect(newValues.is_active).toBe(true);
  });

  it("stringifies bigint values (catch-all branch)", async () => {
    // `typeof 100n === "bigint"` misses every explicit branch in redact()
    // and falls into the final `String(value)` catch-all — locking that
    // branch is important because bigint would otherwise crash JSON.stringify.
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "employees",
      newValues: {
        big: 100n,
      },
    });
    const call = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    const newValues = call["p_new_values"] as Record<string, unknown>;
    expect(typeof newValues.big).toBe("string");
    expect(newValues.big).toBe("100");
  });

  it("does NOT redact when oldValues / newValues / metadata are absent", async () => {
    await recordAudit({
      actionType: "EXPORT",
      resourceName: "expenses",
      resourceId: "res-1",
    });
    const call = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    // The wrapper uses `input.x ? redact(x) : undefined` so absent inputs are undefined.
    expect(call["p_old_values"]).toBeUndefined();
    expect(call["p_new_values"]).toBeUndefined();
    expect(call["p_metadata"]).toBeUndefined();
  });

  it("redacts metadata too", async () => {
    await recordAudit({
      actionType: "EXPORT",
      resourceName: "expenses",
      metadata: { service_role_key: "sr-1", note: "test" },
    });
    const call = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    const meta = call["p_metadata"] as Record<string, unknown>;
    expect(meta.service_role_key).toBe("[REDACTED]");
    expect(meta.note).toBe("test");
  });
});

describe("recordAudit — RPC error surface", () => {
  it("throws when the RPC returns a Supabase error", async () => {
    rpcMock.mockResolvedValueOnce({ error: { message: "policy denied" } });
    await expect(
      recordAudit({
        actionType: "CREATE",
        resourceName: "expenses",
      }),
    ).rejects.toThrow(/audit log write failed: policy denied/);
  });
});
