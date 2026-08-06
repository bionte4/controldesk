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
});
