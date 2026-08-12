import "server-only";

import Redis from "ioredis";

/**
 * ControlDesk AI cost cap (rules §15).
 *
 * Every insight generation MUST first `reserve()` its estimated output token
 * budget against the tenant's daily quota. If the reservation would blow the
 * quota, `reserve()` refuses and the caller returns an actionable error.
 *
 * When the actual call completes, the caller `commit()` the real delta
 * (positive if we underestimated, negative if we overestimated).
 *
 * Falls back to an in-memory Map when Redis is unavailable — good enough for
 * dev & tests, unsafe for multi-instance production.
 */

export const DEFAULT_DAILY_TOKEN_CAP = Number(
  process.env.AI_DAILY_TOKEN_CAP ?? 10_000,
);

let redisSingleton: Redis | null = null;
let redisPoisoned = false;

function getRedis(): Redis | null {
  if (redisPoisoned) return null;
  if (redisSingleton) return redisSingleton;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redisSingleton = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    redisSingleton.on("error", () => {
      redisPoisoned = true;
    });
    return redisSingleton;
  } catch {
    redisPoisoned = true;
    return null;
  }
}

const memoryStore = new Map<string, { count: number; resetAt: number }>();

function todayKey(tenantId: string): string {
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10);
  return `ai:tokens:${tenantId}:${yyyymmdd}`;
}

function nextMidnightSec(): number {
  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
    ),
  );
  return Math.floor(tomorrow.getTime() / 1000);
}

async function increment(
  key: string,
  by: number,
  ttlSec: number,
): Promise<number> {
  const redis = getRedis();
  if (!redis) {
    const now = Math.floor(Date.now() / 1000);
    const entry = memoryStore.get(key);
    if (!entry || entry.resetAt <= now) {
      memoryStore.set(key, { count: by, resetAt: now + ttlSec });
      return by;
    }
    entry.count += by;
    return entry.count;
  }

  try {
    const pipeline = redis.multi();
    pipeline.incrby(key, by);
    pipeline.expire(key, ttlSec, "NX");
    const result = await pipeline.exec();
    if (!result) return by;
    return Number(result[0]?.[1] ?? by);
  } catch {
    return by;
  }
}

export type ReserveOptions = {
  tenantId: string;
  estimatedOutputTokens: number;
  cap?: number;
};

export type ReservationResult =
  | { ok: true; used: number; cap: number; remaining: number }
  | { ok: false; used: number; cap: number; wouldExceedBy: number };

/**
 * Reserve `estimatedOutputTokens` against today's tenant cap. Returns a
 * decision object; the caller MUST refuse to invoke the LLM when
 * `ok === false`.
 */
export async function reserve(opts: ReserveOptions): Promise<ReservationResult> {
  const cap = opts.cap ?? DEFAULT_DAILY_TOKEN_CAP;
  if (opts.estimatedOutputTokens <= 0) {
    return { ok: true, used: 0, cap, remaining: cap };
  }

  const key = todayKey(opts.tenantId);
  const ttl = nextMidnightSec() - Math.floor(Date.now() / 1000);
  const newTotal = await increment(key, opts.estimatedOutputTokens, ttl);
  if (newTotal > cap) {
    // Roll back the reservation so we don't double-count.
    await increment(key, -opts.estimatedOutputTokens, ttl);
    return {
      ok: false,
      used: newTotal - opts.estimatedOutputTokens,
      cap,
      wouldExceedBy: newTotal - cap,
    };
  }
  return { ok: true, used: newTotal, cap, remaining: cap - newTotal };
}

/**
 * Commit the delta between the reservation and the actual usage. Positive
 * `delta` charges the tenant more; negative `delta` refunds the tenant.
 */
export async function commit(opts: {
  tenantId: string;
  delta: number;
}): Promise<void> {
  if (opts.delta === 0) return;
  const key = todayKey(opts.tenantId);
  const ttl = nextMidnightSec() - Math.floor(Date.now() / 1000);
  await increment(key, opts.delta, ttl);
}

/**
 * Test-only helper: reset the memory store between test cases.
 */
export function __resetForTests(): void {
  memoryStore.clear();
}
