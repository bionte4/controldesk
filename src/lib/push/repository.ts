import "server-only";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";

/**
 * ControlDesk — Web Push subscription repository (rules §17 data layer).
 *
 * Two entry points are intentional:
 *
 * - `saveSubscriptionForCurrentUser()` runs under a session client
 *   (`createClient()`). RLS enforces `tenant_id = current_tenant_id()`
 *   and `user_id = auth.uid()` — a compromised browser cannot forge
 *   another user's endpoint.
 *
 * - `listActiveSubscriptionsForUser()` and `markSubscriptionDisabled()`
 *   run under service role. The dispatcher (`src/lib/push/send.ts`)
 *   is called from both Server Actions (session available) and cron
 *   routes (no session). One code path must work in both worlds; the
 *   session client silently fails-open in cron context which would
 *   drop notifications for every recipient that isn't the caller.
 *
 *   Service role bypasses RLS, so tenant isolation rests on two
 *   explicit filters at query time: `.eq("tenant_id", …)` AND
 *   `.eq("user_id", …)`. Unit test in `repository.test.ts` locks this
 *   in with a cross-tenant recipient assertion.
 */

export type PushSubscription = {
  id: string;
  tenantId: string;
  userId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  disabledAt: string | null;
};

/**
 * Called from `POST /api/push/subscribe` after the browser hands us
 * a fresh subscription. Idempotent — if the same `(tenant_id, endpoint)`
 * pair already exists we UPDATE keys (they can rotate) and clear any
 * previous `disabled_at` marker (user re-enabled after we soft-killed
 * on a prior 410).
 */
export async function saveSubscriptionForCurrentUser(input: {
  tenantId: string;
  userId: string;
  endpoint: string;
  keysP256dh: string;
  keysAuth: string;
  userAgent: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  // Truncate UA to keep the column bounded — helps index sanity if we
  // ever add a `(tenant, user_agent)` covering index. Chrome UAs
  // routinely hit 200+ chars.
  const ua = input.userAgent?.slice(0, 512) ?? null;

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      tenant_id: input.tenantId,
      user_id: input.userId,
      endpoint: input.endpoint,
      keys_p256dh: input.keysP256dh,
      keys_auth: input.keysAuth,
      user_agent: ua,
      // Reset the disable state on re-subscribe (e.g. user granted
      // permission again after previously revoking).
      disabled_at: null,
      disabled_reason: null,
      last_used_at: null,
    },
    { onConflict: "tenant_id,endpoint" },
  );

  if (error) {
    log.warn("push_subscription_save_failed", {
      err: error.message,
      tenant_id: input.tenantId,
      user_id: input.userId,
    });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Called from `DELETE /api/push/subscribe` when the user opts out.
 * Hard delete because there is no audit value in retaining an opted-out
 * subscription (unlike an approval or timesheet row). If the user
 * re-enables later they'll get a fresh row with a new endpoint anyway.
 */
export async function deleteSubscriptionForCurrentUser(input: {
  endpoint: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  // RLS on `push_subscriptions` restricts the DELETE to
  // `user_id = auth.uid()`, so passing just `endpoint` is safe — the
  // policy prevents a client from deleting another user's row even
  // if they forge the endpoint.
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", input.endpoint);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Dispatcher-side query. Returns only ACTIVE subscriptions (never-
 * disabled or explicitly re-enabled). Runs under service role — see
 * file header for rationale.
 */
export async function listActiveSubscriptionsForUser(input: {
  tenantId: string;
  userId: string;
}): Promise<PushSubscription[]> {
  const supabase = createServiceRoleClient();

  // TENANT ISOLATION: service role bypasses RLS. We MUST filter both
  // tenant_id AND user_id explicitly. A tenant-only filter would leak
  // if the caller was ever confused about which user to page.
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select(
      "id, tenant_id, user_id, endpoint, keys_p256dh, keys_auth, user_agent, created_at, last_used_at, disabled_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .is("disabled_at", null);

  if (error) {
    log.warn("push_subscription_list_failed", {
      err: error.message,
      tenant_id: input.tenantId,
      user_id: input.userId,
    });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    endpoint: row.endpoint,
    keys: { p256dh: row.keys_p256dh, auth: row.keys_auth },
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    disabledAt: row.disabled_at,
  }));
}

/**
 * Called by the dispatcher when the push service returns 404/410 —
 * the device is gone. We flip `disabled_at` rather than deleting so
 * ops can still answer "why did user X stop getting push".
 *
 * Service role because `notifyUser()` runs in both Server Action and
 * cron contexts; a session-client update would silently no-op on cron
 * paths (see file header).
 */
export async function markSubscriptionDisabled(input: {
  subscriptionId: string;
  reason: string;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .update({
      disabled_at: new Date().toISOString(),
      disabled_reason: input.reason.slice(0, 200),
    })
    .eq("id", input.subscriptionId);

  if (error) {
    log.warn("push_subscription_disable_failed", {
      err: error.message,
      subscription_id: input.subscriptionId,
    });
  }
}

/**
 * Bump `last_used_at` on a successful send. Non-critical — a failure
 * here just means we lose a debugging breadcrumb, so we swallow the
 * error and move on.
 */
export async function touchSubscription(input: {
  subscriptionId: string;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("push_subscriptions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", input.subscriptionId);
}

/**
 * Preferences page helper — how many devices does the current user
 * have subscribed right now? Uses session client so RLS naturally
 * scopes to `auth.uid()`.
 */
export async function countActiveSubscriptionsForCurrentUser(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .is("disabled_at", null);
  return count ?? 0;
}
