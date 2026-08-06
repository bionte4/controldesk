import "server-only";

import Redis from "ioredis";

/**
 * Fixed-window rate limiter (rules §3).
 *
 * - Prefers Redis when `process.env.REDIS_URL` is set (docker-compose ships
 *   a Redis service). Uses atomic INCR + EXPIRE so many replicas share the
 *   same counter.
 * - Falls back to an in-process Map when Redis is unavailable — good enough
 *   for local dev + tests, unsafe for multi-instance production.
 *
 * Usage:
 *
 *   const { allowed, remaining, resetAt } = await limit(
 *     `auth:login:${ip}`,
 *     { max: 5, windowSeconds: 60 },
 *   );
 *   if (!allowed) throw new Error("Too many requests");
 */

export type RateLimitOptions = {
  /** Maximum number of hits allowed in the window. */
  max: number;
  /** Window size in whole seconds. */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number; // unix seconds
  count: number;
};

// ---------------------------------------------------------------------------
// Redis singleton (lazy — never instantiated in build-time envs).
// ---------------------------------------------------------------------------
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
      // Do not spam logs when Redis is unreachable — fall back silently.
      showFriendlyErrorStack: process.env.NODE_ENV !== "production",
    });
    redisSingleton.on("error", () => {
      // Poison the singleton so future calls fall back cleanly. Reset on
      // process restart. This keeps a bad Redis from taking down /api.
      redisPoisoned = true;
    });
    return redisSingleton;
  } catch {
    redisPoisoned = true;
    return null;
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback.
// ---------------------------------------------------------------------------
type MemoryEntry = { count: number; resetAt: number };
const memoryStore = new Map<string, MemoryEntry>();

function memoryLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Math.floor(Date.now() / 1000);
  const existing = memoryStore.get(key);
  if (!existing || existing.resetAt <= now) {
    const entry: MemoryEntry = { count: 1, resetAt: now + opts.windowSeconds };
    memoryStore.set(key, entry);
    return {
      allowed: true,
      count: 1,
      remaining: opts.max - 1,
      resetAt: entry.resetAt,
    };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= opts.max,
    count: existing.count,
    remaining: Math.max(0, opts.max - existing.count),
    resetAt: existing.resetAt,
  };
}

// ---------------------------------------------------------------------------
// Public entry.
// ---------------------------------------------------------------------------
export async function limit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  if (opts.max <= 0 || opts.windowSeconds <= 0) {
    throw new Error("rate-limit: max and windowSeconds must be > 0");
  }
  const redis = getRedis();
  if (!redis) {
    return memoryLimit(key, opts);
  }

  const namespaced = `rl:${key}`;
  try {
    // Atomic INCR + conditional EXPIRE. EXPIRE only sets a TTL if none is
    // set yet, which keeps the window aligned to the first hit.
    const pipeline = redis.multi();
    pipeline.incr(namespaced);
    pipeline.expire(namespaced, opts.windowSeconds, "NX");
    pipeline.pttl(namespaced);
    const result = await pipeline.exec();

    if (!result) return memoryLimit(key, opts);
    const count = Number(result[0]?.[1] ?? 0);
    const pttl = Number(result[2]?.[1] ?? -1);
    const nowSec = Math.floor(Date.now() / 1000);
    const resetAt =
      pttl > 0 ? nowSec + Math.ceil(pttl / 1000) : nowSec + opts.windowSeconds;

    return {
      allowed: count <= opts.max,
      count,
      remaining: Math.max(0, opts.max - count),
      resetAt,
    };
  } catch {
    // Redis blew up mid-call — degrade gracefully.
    return memoryLimit(key, opts);
  }
}

/**
 * Convenience preset factories. Modules should import these instead of
 * hard-coding numbers so tuning happens in one place.
 */
export const RateLimitPresets = {
  authAttempt: (): RateLimitOptions => ({ max: 5, windowSeconds: 60 }),
  passwordReset: (): RateLimitOptions => ({ max: 3, windowSeconds: 900 }),
  expensiveMutation: (): RateLimitOptions => ({ max: 30, windowSeconds: 60 }),
  aiCall: (): RateLimitOptions => ({ max: 20, windowSeconds: 60 }),
  publicApi: (): RateLimitOptions => ({ max: 60, windowSeconds: 60 }),
} as const;
