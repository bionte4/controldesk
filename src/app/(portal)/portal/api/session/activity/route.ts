import { NextResponse } from "next/server";

import { getCurrentPortalSession } from "@/lib/portal/session";
import {
  SESSION_ACTIVITY_COOKIE,
  SESSION_STARTED_COOKIE,
  createSessionTimestamp,
  sessionCookieOptions,
  verifySessionTimestamp,
} from "@/lib/security/session-timeout-cookie";

export async function POST(request: Request) {
  const session = await getCurrentPortalSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieMap = new Map(cookieHeader.split(";").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return [name, rest.join("=")];
  }));
  const now = Date.now();
  const started = await verifySessionTimestamp(cookieMap.get(SESSION_STARTED_COOKIE));
  const response = NextResponse.json({ ok: true, at: now });
  response.cookies.set(SESSION_ACTIVITY_COOKIE, await createSessionTimestamp(now), sessionCookieOptions);
  if (!started) response.cookies.set(SESSION_STARTED_COOKIE, await createSessionTimestamp(now), sessionCookieOptions);
  response.headers.set("cache-control", "no-store");
  return response;
}
