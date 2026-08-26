import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  SESSION_ACTIVITY_COOKIE,
  SESSION_STARTED_COOKIE,
  createSessionTimestamp,
  sessionCookieOptions,
  verifySessionTimestamp,
} from "@/lib/security/session-timeout-cookie";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = new Map(cookieHeader.split(";").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return [name, rest.join("=")];
  }));
  const now = Date.now();
  const existingStart = await verifySessionTimestamp(cookies.get(SESSION_STARTED_COOKIE));
  const response = NextResponse.json({ ok: true, at: now });
  response.cookies.set(SESSION_ACTIVITY_COOKIE, await createSessionTimestamp(now), sessionCookieOptions);
  if (!existingStart) {
    response.cookies.set(SESSION_STARTED_COOKIE, await createSessionTimestamp(now), sessionCookieOptions);
  }
  response.headers.set("cache-control", "no-store");
  return response;
}
