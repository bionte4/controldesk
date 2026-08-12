import { beforeEach, describe, expect, it } from "vitest";

import { __resetForTests, commit, reserve } from "./cost-cap";

describe("AI cost cap (in-memory fallback)", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("allows requests within cap", async () => {
    const r = await reserve({
      tenantId: "t1",
      estimatedOutputTokens: 500,
      cap: 1000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.used).toBe(500);
      expect(r.remaining).toBe(500);
      expect(r.cap).toBe(1000);
    }
  });

  it("rejects when reservation would exceed cap", async () => {
    await reserve({
      tenantId: "t2",
      estimatedOutputTokens: 800,
      cap: 1000,
    });
    const r = await reserve({
      tenantId: "t2",
      estimatedOutputTokens: 500,
      cap: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.wouldExceedBy).toBe(300);
      expect(r.used).toBe(800);
    }
  });

  it("rolls back the failed reservation so the used counter stays accurate", async () => {
    await reserve({ tenantId: "t3", estimatedOutputTokens: 900, cap: 1000 });
    const denied = await reserve({
      tenantId: "t3",
      estimatedOutputTokens: 200,
      cap: 1000,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.used).toBe(900);

    // A smaller subsequent request must still be honoured up to the cap.
    const ok = await reserve({
      tenantId: "t3",
      estimatedOutputTokens: 100,
      cap: 1000,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.used).toBe(1000);
  });

  it("isolates tenants", async () => {
    await reserve({ tenantId: "ta", estimatedOutputTokens: 900, cap: 1000 });
    const b = await reserve({
      tenantId: "tb",
      estimatedOutputTokens: 900,
      cap: 1000,
    });
    expect(b.ok).toBe(true);
  });

  it("commit adjusts the counter both up and down", async () => {
    await reserve({
      tenantId: "t4",
      estimatedOutputTokens: 500,
      cap: 1000,
    });
    await commit({ tenantId: "t4", delta: 100 }); // total 600
    const next = await reserve({
      tenantId: "t4",
      estimatedOutputTokens: 350,
      cap: 1000,
    });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.used).toBe(950);

    await commit({ tenantId: "t4", delta: -400 }); // total 550
    const another = await reserve({
      tenantId: "t4",
      estimatedOutputTokens: 400,
      cap: 1000,
    });
    expect(another.ok).toBe(true);
    if (another.ok) expect(another.used).toBe(950);
  });

  it("treats non-positive estimates as a no-op", async () => {
    const r = await reserve({
      tenantId: "t5",
      estimatedOutputTokens: 0,
      cap: 1000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.used).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Per-tenant cap override (Phase 3 — tenant_ai_configs.daily_token_cap)
  // -------------------------------------------------------------------------
  it("honours a per-tenant cap tighter than the global default", async () => {
    // Simulates the caller passing `cap: resolveDailyTokenCap(tenantId)`
    // when the tenant has `daily_token_cap = 1500` in tenant_ai_configs.
    const first = await reserve({
      tenantId: "tenant-strict",
      estimatedOutputTokens: 1000,
      cap: 1500,
    });
    expect(first.ok).toBe(true);

    const second = await reserve({
      tenantId: "tenant-strict",
      estimatedOutputTokens: 600,
      cap: 1500,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.wouldExceedBy).toBe(100);
      // Rollback keeps the used counter at 1000, not 1600.
      expect(second.used).toBe(1000);
    }
  });

  it("honours a per-tenant cap wider than the global default", async () => {
    // Enterprise tenant with `daily_token_cap = 50_000` — should be able
    // to spend much more than the env default (10_000 in prod).
    const r = await reserve({
      tenantId: "tenant-enterprise",
      estimatedOutputTokens: 25_000,
      cap: 50_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.remaining).toBe(25_000);
  });

  it("isolates per-tenant caps across tenants (no leakage)", async () => {
    // Tenant A has a 1000 cap and is at its ceiling.
    await reserve({
      tenantId: "tenant-a",
      estimatedOutputTokens: 1000,
      cap: 1000,
    });

    // Tenant B has a 5000 cap. It must NOT inherit A's exhausted budget.
    const b = await reserve({
      tenantId: "tenant-b",
      estimatedOutputTokens: 3000,
      cap: 5000,
    });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.remaining).toBe(2000);
  });

  it("uses DEFAULT_DAILY_TOKEN_CAP when the caller omits `cap`", async () => {
    // Simulates the code path where `resolveDailyTokenCap()` returns
    // null (no tenant config or provider inactive) — the reserve() call
    // then omits `cap` and falls back to the env default.
    const r = await reserve({
      tenantId: "tenant-default",
      estimatedOutputTokens: 500,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Default is 10_000 unless AI_DAILY_TOKEN_CAP env is set — either
      // way the reservation must succeed and `cap` must be a positive int.
      expect(r.cap).toBeGreaterThan(0);
      expect(r.used).toBe(500);
    }
  });
});
