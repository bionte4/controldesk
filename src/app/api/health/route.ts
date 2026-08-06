import { NextResponse } from "next/server";

/**
 * Docker healthcheck endpoint (rules §2).
 *
 * MUST be reachable without authentication, without a tenant subdomain, and
 * without any DB round-trip so the orchestrator can mark the container
 * healthy the instant Node.js is accepting requests. Detailed liveness
 * probes (DB / Redis reachability) belong in a separate `/api/ready` route
 * scoped to platform ops later.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "controldesk",
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.round(process.uptime()),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
