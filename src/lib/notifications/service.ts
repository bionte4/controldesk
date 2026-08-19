import "server-only";

import { createClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/integrations/telegram/client";
import { loadUserLink } from "@/lib/integrations/telegram/repository";
import { sendWhatsAppMessage } from "@/lib/integrations/whatsapp/client";
import { loadUserWhatsAppLink } from "@/lib/integrations/whatsapp/repository";
import { log } from "@/lib/observability/log";
import type { AnyDbEmployeeRole, EmployeeRole } from "@/lib/rbac/roles";
import type { NotificationKind } from "@/types/database";

import { dispatchWebPush } from "@/lib/push/send";

import { categoryForKind } from "./categories";
import { dispatchNotificationEmail } from "./email-dispatcher";
import { isChannelEnabled } from "./preferences";

/**
 * ControlDesk in-app notification service (rules §20).
 *
 * Wraps the `public.enqueue_notification` RPC (SECURITY DEFINER) so
 * server actions can fan out approval events to the appropriate approver
 * without leaking cross-tenant data.
 *
 * The RPC enforces tenant isolation itself; we still call it defensively
 * (single-tenant per invocation) and swallow errors so a notification hiccup
 * never fails the underlying business mutation.
 */

export type NotifyRecipient = {
  /**
   * Auth user id. Can be `null` for employees added by HR before they have
   * activated a system account (see migration 0034). In that case the
   * notification is silently dropped — there is no inbox to deliver to.
   */
  userId: string | null;
  employeeId?: string | null;
};

/**
 * Fire a single in-app notification. Errors are logged, never thrown.
 * No-op when the recipient has no `user_id` (HR-only employee record).
 *
 * Preference-gated (migration 0068): if the recipient has opted out
 * of the IN_APP channel for the kind's category, we silently skip
 * the insert. Missing preferences rows fail-open — legacy users
 * without opt-outs keep seeing everything.
 */
export async function notifyUser(input: {
  recipient: NotifyRecipient;
  kind: NotificationKind;
  title: string;
  body?: string;
  actionUrl?: string;
  payload?: Record<string, unknown>;
  /**
   * Optional. When provided, we consult
   * `user_notification_preferences` before enqueuing so users
   * can silence a category. Callers who don't yet have the
   * tenant handy pass `undefined` and we default to legacy
   * always-deliver behaviour.
   */
  tenantId?: string;
}): Promise<{ ok: boolean; error?: string; skipped?: "prefs" | "no_user" }> {
  if (!input.recipient.userId) {
    return { ok: true, skipped: "no_user" };
  }

  // Preference gate — only queried when the caller passed `tenantId`.
  // This preserves compat with older call sites while giving the new
  // Preferences page an immediate effect.
  if (input.tenantId) {
    const category = categoryForKind(input.kind);
    const allowed = await isChannelEnabled({
      tenantId: input.tenantId,
      userId: input.recipient.userId,
      category,
      channel: "IN_APP",
    });
    if (!allowed) {
      return { ok: true, skipped: "prefs" };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("enqueue_notification", {
    p_recipient_user_id: input.recipient.userId,
    p_kind: input.kind,
    p_title: input.title,
    p_body: input.body ?? undefined,
    p_action_url: input.actionUrl ?? undefined,
    p_payload: input.payload ? (input.payload as never) : undefined,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  // Best-effort out-of-band fan-out — only when the caller supplied
  // tenantId (so we know which tenant's bot / gateway / email config
  // to load) and the user opted into that specific channel for this
  // category. Failures never propagate — the in-app message is the
  // source of truth; Telegram / WhatsApp / Email are just echoes
  // (rules §20).
  //
  // All three side channels fire in parallel via `void`; a slow
  // provider on one channel must never delay delivery on the others,
  // nor block the caller's Server Action.
  if (input.tenantId) {
    void dispatchTelegram({
      tenantId: input.tenantId,
      userId: input.recipient.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl,
    }).catch((err) => {
      log.warn("telegram_dispatch_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    void dispatchWhatsApp({
      tenantId: input.tenantId,
      userId: input.recipient.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl,
    }).catch((err) => {
      log.warn("whatsapp_dispatch_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    void dispatchNotificationEmail({
      tenantId: input.tenantId,
      userId: input.recipient.userId,
      employeeId: input.recipient.employeeId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl,
    }).catch((err) => {
      log.warn("email_dispatch_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    // Web Push (PWA / Android APK) — Day 2 wiring. Same pattern as the
    // other side channels: fire-and-forget, per-user preference gate
    // handled INSIDE dispatchWebPush (so a slow prefs query on one
    // channel doesn't cascade to another). Missing VAPID env vars
    // gracefully no-op instead of crashing.
    void dispatchWebPush({
      tenantId: input.tenantId,
      userId: input.recipient.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl,
    }).catch((err) => {
      log.warn("web_push_dispatch_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { ok: true };
}

/**
 * Fire-and-forget Telegram dispatcher. Called from `notifyUser` after
 * an in-app enqueue succeeds. Not awaited so a slow Telegram API
 * cannot block the mutating Server Action that scheduled it.
 */
async function dispatchTelegram(input: {
  tenantId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  actionUrl?: string;
}): Promise<void> {
  const category = categoryForKind(input.kind);
  const allowed = await isChannelEnabled({
    tenantId: input.tenantId,
    userId: input.userId,
    category,
    channel: "TELEGRAM",
  });
  if (!allowed) return;

  const link = await loadUserLink({
    tenantId: input.tenantId,
    userId: input.userId,
  });
  if (!link) return;

  // Escape angle brackets so payload text can't smuggle HTML into
  // the Telegram render surface (parse_mode=HTML).
  const escape = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const title = escape(input.title);
  const bodyLine = input.body ? `\n${escape(input.body)}` : "";
  const linkLine = input.actionUrl
    ? `\n\n<a href="${escape(input.actionUrl)}">Open in ControlDesk</a>`
    : "";

  await sendTelegramMessage({
    tenantId: input.tenantId,
    chatId: link.chatId,
    text: `<b>${title}</b>${bodyLine}${linkLine}`,
  });
}

/**
 * Fire-and-forget WhatsApp dispatcher. Mirror of `dispatchTelegram`
 * but talks to a Twilio/Fonnte/Meta gateway configured per-tenant.
 *
 * Formatting notes:
 *   * WhatsApp does NOT render HTML — it uses its own light markup
 *     (`*bold*`, `_italic_`, `~strike~`, `\`\`\`mono\`\`\``). We only
 *     use bold for the title, plain text for the body, and append the
 *     action URL as a bare link so the WhatsApp client autolinks it.
 *   * No HTML escaping needed — payload lands as text/plain.
 *   * If the user has no linked WA number (`user_whatsapp_links`),
 *     silently exit; the linking flow lives in Preferences.
 *   * If the tenant has no active gateway, `sendWhatsAppMessage`
 *     returns `NO_CONFIG` which we log at info and drop — a tenant
 *     that hasn't wired WhatsApp is not an error condition.
 */
async function dispatchWhatsApp(input: {
  tenantId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  actionUrl?: string;
}): Promise<void> {
  const category = categoryForKind(input.kind);
  const allowed = await isChannelEnabled({
    tenantId: input.tenantId,
    userId: input.userId,
    category,
    channel: "WHATSAPP",
  });
  if (!allowed) return;

  const link = await loadUserWhatsAppLink({
    tenantId: input.tenantId,
    userId: input.userId,
  });
  if (!link) return;

  const bodyLine = input.body ? `\n${input.body}` : "";
  const linkLine = input.actionUrl ? `\n\n${input.actionUrl}` : "";
  const text = `*${input.title}*${bodyLine}${linkLine}`;

  const res = await sendWhatsAppMessage({
    tenantId: input.tenantId,
    waId: link.waId,
    text,
  });
  if (!res.ok) {
    // NO_CONFIG is normal for tenants that have not enabled WA yet;
    // TIMEOUT / PROVIDER_ERROR / HTTP are worth surfacing but not
    // fatal — the in-app row is already persisted.
    if (res.code === "NO_CONFIG" || res.code === "NO_LINK") {
      log.info("whatsapp_dispatch_skipped", {
        tenant_id: input.tenantId,
        code: res.code,
      });
      return;
    }
    log.warn("whatsapp_dispatch_provider_error", {
      tenant_id: input.tenantId,
      code: res.code,
      err: res.error,
    });
  }
}

/**
 * Fan out a notification to every ACTIVE employee in the given tenant whose
 * `role` is in `roles`. Best-effort — silently skips any single-recipient
 * failures.
 */
export async function notifyRoles(input: {
  tenantId: string;
  /**
   * Accepts both legacy DB codes (e.g. `PROJECT_MANAGER`) and canonical
   * ones (e.g. `PM`). We simply forward the strings to the `IN (...)` clause
   * on `employees.role`, so mixing both is safe as long as the value exists
   * in the DB enum (see migration 0021).
   */
  roles: readonly (EmployeeRole | AnyDbEmployeeRole)[];
  kind: NotificationKind;
  title: string;
  body?: string;
  actionUrl?: string;
  payload?: Record<string, unknown>;
}): Promise<{ delivered: number; failed: number }> {
  if (input.roles.length === 0) return { delivered: 0, failed: 0 };

  const supabase = await createClient();
  const { data: recipients, error } = await supabase
    .from("employees")
    .select("user_id, id")
    .eq("tenant_id", input.tenantId)
    .eq("is_active", true)
    // Cast: `roles` widens across legacy + canonical DB codes. Supabase's
    // generated `.in()` narrows to the legacy union — the DB enum actually
    // accepts all values (see migration 0021).
    .in("role", [...input.roles] as unknown as EmployeeRole[]);
  if (error || !recipients) return { delivered: 0, failed: 0 };

  let delivered = 0;
  let failed = 0;
  await Promise.all(
    recipients
      .filter((r) => r.user_id !== null)
      .map(async (r) => {
        const res = await notifyUser({
          recipient: { userId: r.user_id, employeeId: r.id },
          kind: input.kind,
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl,
          payload: input.payload,
          // Thread tenant so per-recipient prefs are honoured.
          tenantId: input.tenantId,
        });
        if (res.ok) delivered += 1;
        else failed += 1;
      }),
  );
  return { delivered, failed };
}
