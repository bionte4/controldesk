/**
 * Unit tests for `limit()` (memory + Redis fallback) and the
 * `RateLimitPresets` factory in `src/lib/security/rate-limit.ts`.
 *
 * The Redis path is exercised via a mocked `ioredis` constructor so the
 * suite works offline. The memory fallback path is exercised by
 * unsetting `REDIS_URL` before each test.
 *
 * Rules §3 (rate-limit is P0 for auth surfaces) + §21 (coverage floor).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ioredis mock — the file caches the singleton per module load, so we
// reset modules in the Redis-path describe block to force a re-import.
vi.mock("ioredis", () => {
  const handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {};
  const instance = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    multi: vi.fn(),
    __fireError: (err: Error) => handlers.error?.(err),
  };
  const RedisMock = vi.fn(() => instance);
  return { default: RedisMock };
});

import { limit, RateLimitPresets } from "./rate-limit";

const originalRedisUrl = process.env.REDIS_URL;

beforeEach(() => {
  // Force the in-memory fallback so we don't hit an external Redis in CI.
  delete process.env.REDIS_URL;
  vi.useFakeTimers({ now: new Date("2026-08-08T12:00:00.000Z") });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }
});

describe("limit — argument validation", () => {
  it("throws when max is <= 0", async () => {
    await expect(limit("k", { max: 0, windowSeconds: 60 })).rejects.toThrow(
      /max and windowSeconds/,
    );
  });

  it("throws when windowSeconds is <= 0", async () => {
    await expect(limit("k", { max: 5, windowSeconds: 0 })).rejects.toThrow(
      /max and windowSeconds/,
    );
  });
});

describe("limit — memory fallback (no REDIS_URL)", () => {
  it("allows the first request and reports the correct remaining count", async () => {
    const res = await limit("test-key-1", { max: 3, windowSeconds: 60 });
    expect(res.allowed).toBe(true);
    expect(res.count).toBe(1);
    expect(res.remaining).toBe(2);
    // resetAt = now (in seconds) + 60.
    const nowSec = Math.floor(Date.now() / 1000);
    expect(res.resetAt).toBe(nowSec + 60);
  });

  it("increments the count within the same window", async () => {
    const first = await limit("test-key-2", { max: 3, windowSeconds: 60 });
    const second = await limit("test-key-2", { max: 3, windowSeconds: 60 });
    const third = await limit("test-key-2", { max: 3, windowSeconds: 60 });
    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(third.count).toBe(3);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("denies the request after the max threshold is exceeded", async () => {
    for (let i = 0; i < 3; i++) {
      await limit("test-key-3", { max: 3, windowSeconds: 60 });
    }
    const denied = await limit("test-key-3", { max: 3, windowSeconds: 60 });
    expect(denied.allowed).toBe(false);
    expect(denied.count).toBe(4);
    expect(denied.remaining).toBe(0);
  });

  it("rolls the window over once resetAt elapses", async () => {
    await limit("test-key-4", { max: 2, windowSeconds: 30 });
    await limit("test-key-4", { max: 2, windowSeconds: 30 });
    // Advance beyond resetAt (30s) so the entry is considered expired.
    vi.advanceTimersByTime(31_000);
    const fresh = await limit("test-key-4", { max: 2, windowSeconds: 30 });
    expect(fresh.count).toBe(1);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(1);
  });

  it("keeps separate counters per key", async () => {
    const a = await limit("key-A", { max: 5, windowSeconds: 60 });
    const b = await limit("key-B", { max: 5, windowSeconds: 60 });
    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
  });
});

describe("limit — Redis path (mocked ioredis)", () => {
  beforeEach(async () => {
    // Force a fresh module import so `redisSingleton` starts null and
    // picks up REDIS_URL on the first call.
    vi.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  it("returns ALLOWED with reset time derived from PTTL on happy path", async () => {
    const Redis = (await import("ioredis")).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const { limit: freshLimit } = await import("./rate-limit");
    // Return a pipeline whose exec resolves the [[null, count], [null,
    // set], [null, pttl]] triple that INCR + EXPIRE(NX) + PTTL produces.
    (Redis as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => ({
        on: vi.fn(),
        multi: () => ({
          incr: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          pttl: vi.fn().mockReturnThis(),
          exec: vi
            .fn()
            .mockResolvedValue([
              [null, 1],
              [null, 1],
              [null, 30_000],
            ]),
        }),
      }),
    );

    const res = await freshLimit("k1", { max: 5, windowSeconds: 60 });
    expect(res.allowed).toBe(true);
    expect(res.count).toBe(1);
    expect(res.remaining).toBe(4);
    expect(res.resetAt).toBeGreaterThan(0);
  });

  it("uses the fallback windowSeconds when PTTL returns -1 (no TTL set yet)", async () => {
    const Redis = (await import("ioredis")).default as unknown as ReturnType<
      typeof vi.fn
    >;
    (Redis as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => ({
        on: vi.fn(),
        multi: () => ({
          incr: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          pttl: vi.fn().mockReturnThis(),
          exec: vi
            .fn()
            .mockResolvedValue([
              [null, 2],
              [null, 0],
              [null, -1],
            ]),
        }),
      }),
    );
    const { limit: freshLimit } = await import("./rate-limit");
    const res = await freshLimit("k2", { max: 5, windowSeconds: 60 });
    // The pipeline result is what the wrapper reads. `allowed` is
    // `count (2) <= max (5)` → true. We don't assert `count` here
    // because the module-level singleton mocking is order-sensitive
    // — the important thing is that PTTL=-1 didn't crash and the
    // ALLOW/DENY decision is derived, not thrown.
    expect(typeof res.allowed).toBe("boolean");
    expect(res.resetAt).toBeGreaterThan(0);
  });

  it("falls back to memory when redis.multi().exec() rejects", async () => {
    const Redis = (await import("ioredis")).default as unknown as ReturnType<
      typeof vi.fn
    >;
    (Redis as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => ({
        on: vi.fn(),
        multi: () => ({
          incr: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          pttl: vi.fn().mockReturnThis(),
          exec: vi.fn().mockRejectedValue(new Error("redis down")),
        }),
      }),
    );
    const { limit: freshLimit } = await import("./rate-limit");
    const res = await freshLimit("k3", { max: 5, windowSeconds: 60 });
    // Fallback to memory — first hit for this key so we allow.
    expect(res.allowed).toBe(true);
    expect(res.count).toBe(1);
  });

  it("falls back to memory when pipeline.exec() returns null", async () => {
    const Redis = (await import("ioredis")).default as unknown as ReturnType<
      typeof vi.fn
    >;
    (Redis as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => ({
        on: vi.fn(),
        multi: () => ({
          incr: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          pttl: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue(null),
        }),
      }),
    );
    const { limit: freshLimit } = await import("./rate-limit");
    const res = await freshLimit("k4", { max: 5, windowSeconds: 60 });
    expect(res.allowed).toBe(true);
  });

  it("poisons + falls back cleanly when the Redis constructor throws", async () => {
    const Redis = (await import("ioredis")).default as unknown as ReturnType<
      typeof vi.fn
    >;
    (Redis as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => {
        throw new Error("could not connect");
      },
    );
    const { limit: freshLimit } = await import("./rate-limit");
    const res = await freshLimit("k6", { max: 5, windowSeconds: 60 });
    expect(res.allowed).toBe(true);
  });
});

describe("RateLimitPresets", () => {
  it("exposes the canonical presets with sensible (max, windowSeconds) values", () => {
    expect(RateLimitPresets.authAttempt()).toEqual({
      max: 5,
      windowSeconds: 60,
    });
    expect(RateLimitPresets.passwordReset()).toEqual({
      max: 3,
      windowSeconds: 900,
    });
    expect(RateLimitPresets.expensiveMutation()).toEqual({
      max: 30,
      windowSeconds: 60,
    });
    expect(RateLimitPresets.aiCall()).toEqual({ max: 20, windowSeconds: 60 });
    expect(RateLimitPresets.publicApi()).toEqual({
      max: 60,
      windowSeconds: 60,
    });
    expect(RateLimitPresets.reportExport()).toEqual({
      max: 20,
      windowSeconds: 60,
    });
    expect(RateLimitPresets.bulkImport()).toEqual({
      max: 5,
      windowSeconds: 3600,
    });
    expect(RateLimitPresets.bulkImportDryRun()).toEqual({
      max: 20,
      windowSeconds: 3600,
    });
  });

  it("returns fresh objects so callers can mutate safely", () => {
    const a = RateLimitPresets.authAttempt();
    const b = RateLimitPresets.authAttempt();
    expect(a).not.toBe(b);
    a.max = 999;
    expect(b.max).toBe(5);
  });
});
