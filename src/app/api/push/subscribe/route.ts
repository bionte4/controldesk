import { NextResponse } from "next/server";
import { z } from "zod";

import { log } from "@/lib/observability/log";
import {
  deleteSubscriptionForCurrentUser,
  saveSubscriptionForCurrentUser,
} from "@/lib/push/repository";
import { createClient } from "@/lib/supabase/server";
import { requireTenantContext } from "@/lib/tenant/context";

/**
 * ControlDesk — Web Push subscription endpoint (Day 2).
 *
 * ## Why an API Route Handler instead of a Server Action?
 *
 * Server Actions carry a rigid POST-with-form-data contract that
 * doesn't map cleanly to the `PushManager.subscribe()` return value
 * (it's a JSON blob with `endpoint` + `keys.p256dh` + `keys.auth`).
 * A Route Handler lets the client POST that JSON directly with
 * `Content-Type: application/json` — the natural browser API idiom.
 *
 * ## Contract
 *
 * POST   /api/push/subscribe   { endpoint, keys: { p256dh, auth } }
 * DELETE /api/push/subscribe   { endpoint }
 *
 * Both require:
 *   - Authenticated Supabase session (cookie).
 *   - Tenant context resolved by `proxy.ts` (i.e. reached via a
 *     tenant subdomain, not apex).
 *
 * All error responses use `{ ok: false, error: string }` and 4xx/5xx
 * status codes — no leaking of DB error internals to the browser.
 */

// The `PushManager.subscribe()` shape we accept from the browser.
// We do NOT accept `expirationTime` or other fields; ignore them.
const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

async function requireAuthContext() {
  const tenant = await requireTenantContext();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { ok: false as const, status: 401, error: "unauthenticated" };
  }
  // `requireTenantContext()` throws when `id` is null, so the
  // non-null assertion below is safe. TS can't see through the
  // internal `Required<{slug: string|null, id: string|null}>` wrap.
  return {
    ok: true as const,
    tenantId: tenant.id as string,
    userId: data.user.id,
  };
}

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireAuthContext>>;
  try {
    ctx = await requireAuthContext();
  } catch {
    // requireTenantContext throws on apex — a push subscription only
    // makes sense inside a tenant.
    return NextResponse.json({ ok: false, error: "no_tenant" }, { status: 400 });
  }
  if (!ctx.ok) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: ctx.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  const userAgent = request.headers.get("user-agent");
  const result = await saveSubscriptionForCurrentUser({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    endpoint: parsed.data.endpoint,
    keysP256dh: parsed.data.keys.p256dh,
    keysAuth: parsed.data.keys.auth,
    userAgent,
  });

  if (!result.ok) {
    log.warn("push_subscribe_persist_failed", {
      err: result.error,
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
    });
    return NextResponse.json(
      { ok: false, error: "persistence_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireAuthContext>>;
  try {
    ctx = await requireAuthContext();
  } catch {
    return NextResponse.json({ ok: false, error: "no_tenant" }, { status: 400 });
  }
  if (!ctx.ok) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: ctx.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  const result = await deleteSubscriptionForCurrentUser({
    endpoint: parsed.data.endpoint,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "persistence_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
