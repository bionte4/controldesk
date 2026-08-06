import { NextResponse } from "next/server";
import Redis from "ioredis";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";

/**
 * Readiness probe (rules §21).
 *
 * Unlike `/api/health` (liveness — is the Node process up?), this endpoint
 * confirms downstream dependencies are reachable:
 *   - Supabase: can we query `tenants` via the service-role client?
 *   - Redis: can we PING?
 *
 * Returns 200 only when everything is green; otherwise 503 with a JSON body
 * describing which checks failed. Orchestrators (Kubernetes, ECS) should
 * remove pods from the load balancer while this is 503.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckResult =
  | { ok: true; latency_ms: number }
  | { ok: false; latency_ms: number; error: string };

async function checkSupabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .limit(1);
    if (error) {
      return { ok: false, latency_ms: Date.now() - start, error: error.message };
    }
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  const url = process.env.REDIS_URL;
  if (!url) {
    // Redis is optional in some envs; treat missing config as "not applicable".
    return { ok: true, latency_ms: 0 };
  }
  let client: Redis | null = null;
  try {
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1500,
    });
    await client.connect();
    const pong = await client.ping();
    if (pong !== "PONG") {
      return {
        ok: false,
        latency_ms: Date.now() - start,
        error: `unexpected PING response: ${pong}`,
      };
    }
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}

export async function GET() {
  const [supabase, redis] = await Promise.all([checkSupabase(), checkRedis()]);
  const allOk = supabase.ok && redis.ok;

  if (!allOk) {
    log.warn("readiness check failed", {
      supabase_ok: supabase.ok,
      redis_ok: redis.ok,
      supabase_error: supabase.ok ? undefined : supabase.error,
      redis_error: redis.ok ? undefined : redis.error,
    });
  }

  return NextResponse.json(
    {
      status: allOk ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      checks: { supabase, redis },
    },
    {
      status: allOk ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
