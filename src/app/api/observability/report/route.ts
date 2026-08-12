import { NextResponse } from "next/server";
import { z } from "zod";

import { log } from "@/lib/observability/log";
import { limit } from "@/lib/security/rate-limit";

/**
 * Client-side crash report ingestion (rules §21).
 *
 * The endpoint is intentionally *unauthenticated* — a crashed React tree
 * often means the auth cookie is invalid or the session refresh failed. We
 * make it safe with:
 *
 *   • Aggressive per-IP rate limit (60 events / 5 min).
 *   • Same-origin check (browser cannot forge the Referer / Origin from
 *     another site without CORS pre-flight, which we do not answer).
 *   • Payload size cap + Zod schema validation.
 *   • Redaction on the way out to the sink.
 *
 * All accepted reports are forwarded to `log.error()` which fires the
 * server-side sink dispatch.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024; // 16 KB

const payloadSchema = z.object({
  level: z.enum(["warn", "error", "fatal"]).default("error"),
  msg: z.string().min(1).max(2000),
  name: z.string().max(200).optional(),
  stack: z.string().max(8000).optional(),
  route: z.string().max(2000).optional(),
  digest: z.string().max(200).optional(),
  user_agent: z.string().max(500).optional(),
});

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");
  if (!host) return false;
  const expected = new Set([`http://${host}`, `https://${host}`]);
  if (origin && expected.has(origin)) return true;
  if (referer) {
    try {
      const u = new URL(referer);
      return u.host === host;
    } catch {
      return false;
    }
  }
  // No Origin + no Referer — reject.
  return false;
}

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = clientIp(request);
  const rl = await limit(`obs:report:${ip}`, {
    max: 60,
    windowSeconds: 300,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.resetAt) } },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let parsed;
  try {
    parsed = payloadSchema.safeParse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const p = parsed.data;
  const requestId = request.headers.get("x-request-id") ?? undefined;

  // `log.error` dispatches to the configured sink for warn/error/fatal.
  const level = p.level === "warn" ? "warn" : "error";
  const err = p.stack
    ? { name: p.name ?? "ClientError", message: p.msg, stack: p.stack }
    : undefined;

  log[level]("client crash report", {
    source: "client",
    request_id: requestId,
    route: p.route,
    user_agent: p.user_agent,
    digest: p.digest,
    err,
  });

  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
