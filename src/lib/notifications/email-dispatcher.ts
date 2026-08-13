import "server-only";

import { cache } from "react";

import { sendEmail } from "@/lib/notify/mailer";
import { renderEmailBody } from "@/lib/notify/templates/skeleton";
import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getRootDomain } from "@/lib/tenant/resolve";
import type { NotificationKind } from "@/types/database";

import { categoryForKind, isEmailEligibleKind } from "./categories";
import { isChannelEnabled } from "./preferences";

/**
 * Per-item email dispatcher for `notifyUser()`.
 *
 * Called as a fire-and-forget side channel alongside Telegram + WhatsApp.
 * Failures never propagate to the caller — the `notifications` row is
 * source of truth, email is just an echo.
 *
 * Delivery gates (in order — first miss short-circuits):
 *   1. `isEmailEligibleKind(kind)` — kind must be on the approval /
 *      settlement / lifecycle allowlist (categories.ts). Prevents
 *      spam like every timesheet approval hitting the inbox.
 *   2. `isChannelEnabled(EMAIL)` — user must not have opted out of
 *      EMAIL for the kind's category in Preferences.
 *   3. Recipient must have an `employees.email` row on file **inside
 *      the caller-supplied tenant** (explicit `.eq("tenant_id", …)`).
 *   4. Tenant metadata must load AND the returned row's id must equal
 *      the caller-supplied tenantId — defensive equality check to
 *      catch any hypothetical bug that returns a foreign row.
 *
 * ## Tenant isolation
 *
 * We use `createServiceRoleClient()` here instead of a session client
 * for two reasons:
 *   1. The outbox RLS policy only allows service_role INSERT; using
 *      the session client silently fails the audit row (email sent
 *      but no `email_outbox` trace — ops cannot answer "was user X
 *      supposed to be emailed?").
 *   2. `notifyUser()` is called from BOTH Server Actions (session
 *      context) AND cron routes (no session). One code path must
 *      work in both worlds.
 *
 * Service-role bypasses RLS, so tenant isolation now rests on THREE
 * explicit filters:
 *   • `employees.tenant_id = input.tenantId` on the recipient query.
 *   • `tenants.id = input.tenantId` on the tenant meta query.
 *   • `tenant.id === input.tenantId` sanity check post-load.
 * A cross-tenant unit test locks this in.
 *
 * `?from=email` is appended to the CTA URL so downstream approval
 * server actions can log `via_email=true` in the audit trail. Non-goal
 * for now: signed one-click tokens (Pola B); those come later.
 */
export async function dispatchNotificationEmail(input: {
  tenantId: string;
  userId: string;
  employeeId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string;
  actionUrl?: string;
}): Promise<void> {
  if (!isEmailEligibleKind(input.kind)) return;

  const category = categoryForKind(input.kind);
  const allowed = await isChannelEnabled({
    tenantId: input.tenantId,
    userId: input.userId,
    category,
    channel: "EMAIL",
  });
  if (!allowed) return;

  const supabase = createServiceRoleClient();

  const recipient = await loadRecipient(supabase, {
    tenantId: input.tenantId,
    userId: input.userId,
  });
  if (!recipient?.email) {
    log.info("email_dispatch_skipped_no_email", {
      tenant_id: input.tenantId,
      user_id: input.userId,
      kind: input.kind,
    });
    return;
  }

  const tenant = await loadTenantMeta(supabase, input.tenantId);
  if (!tenant) {
    log.warn("email_dispatch_missing_tenant", {
      tenant_id: input.tenantId,
      kind: input.kind,
    });
    return;
  }
  // Defense-in-depth: the query filters on `id = input.tenantId`, so
  // the returned row MUST match. If it doesn't, something is very wrong
  // (schema drift, mocked Supabase in a test that returns a foreign
  // row, or a Postgres bug). Bail rather than send to the wrong tenant.
  if (tenant.id !== input.tenantId) {
    log.error("email_dispatch_tenant_mismatch", {
      tenant_id_expected: input.tenantId,
      tenant_id_loaded: tenant.id,
      kind: input.kind,
    });
    return;
  }

  const absoluteAction = buildAbsoluteActionUrl({
    slug: tenant.slug,
    path: input.actionUrl,
  });

  const subject = `[${tenant.name}] ${input.title}`;
  const { text, html } = renderEmailBody({
    tenantName: tenant.name,
    title: input.title,
    preheader: input.body?.slice(0, 90),
    greeting: `Halo ${recipient.fullName},`,
    sections: input.body ? [{ body: input.body }] : [],
    cta: absoluteAction
      ? { label: "Buka di ControlDesk", url: absoluteAction }
      : undefined,
  });

  const result = await sendEmail({
    to: recipient.email,
    subject,
    text,
    html,
    tenantId: input.tenantId,
    metadata: { kind: input.kind, category, source: "notifyUser" },
  });

  // Best-effort audit row. A failure here shouldn't shadow the send
  // outcome — if the send succeeded but the outbox insert failed, the
  // user still got their email; we just lose one line of the audit
  // trail. Log at warn and move on.
  const { error: outboxErr } = await supabase.from("email_outbox").insert({
    tenant_id: input.tenantId,
    to_address: recipient.email,
    from_address:
      result.from ??
      process.env.SMTP_FROM ??
      "ControlDesk <no-reply@controldesk.app>",
    subject,
    body_text: text,
    body_html: html,
    status: result.status,
    provider: result.provider,
    provider_message_id: result.providerMessageId ?? null,
    error_message: result.error ?? null,
    metadata: {
      source: "notify_user",
      kind: input.kind,
      category,
      user_id: input.userId,
      employee_id: input.employeeId ?? null,
      config_source: result.configSource ?? null,
    },
    sent_at: result.status === "SENT" ? new Date().toISOString() : null,
  });
  if (outboxErr) {
    log.warn("email_dispatch_outbox_insert_failed", {
      tenant_id: input.tenantId,
      kind: input.kind,
      error: outboxErr.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

type Recipient = {
  email: string | null;
  fullName: string;
  preferredLocale: string | null;
};

/**
 * Load the recipient's business email + display name for the header.
 * NOT `cache()`-wrapped because each recipient is unique; there's no
 * dedup benefit within a single Server Action fan-out.
 */
async function loadRecipient(
  supabase: ReturnType<typeof createServiceRoleClient>,
  input: { tenantId: string; userId: string },
): Promise<Recipient | null> {
  const { data } = await supabase
    .from("employees")
    .select("email, full_name, preferred_locale")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!data) return null;
  return {
    email: (data.email as string | null) ?? null,
    fullName: (data.full_name as string) ?? "Rekan",
    preferredLocale: (data.preferred_locale as string | null) ?? null,
  };
}

type TenantMeta = { id: string; name: string; slug: string };

/**
 * Load tenant id + name + slug. `id` is projected so the caller can
 * verify the returned row actually matches the requested tenantId
 * (defense-in-depth against schema drift or mocking bugs).
 *
 * Wrapped in `cache()` because `notifyRoles()` fan-out calls
 * `notifyUser()` many times for the same tenant in one request — no
 * need to hit `tenants` for every recipient. `cache()` scope is
 * per-render (per request), so cache never bleeds across tenants.
 */
const loadTenantMeta = cache(
  async (
    supabase: ReturnType<typeof createServiceRoleClient>,
    tenantId: string,
  ): Promise<TenantMeta | null> => {
    const { data } = await supabase
      .from("tenants")
      .select("id, name, slug")
      .eq("id", tenantId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: (data.id as string) ?? "",
      name: (data.name as string) ?? "ControlDesk",
      slug: (data.slug as string) ?? "",
    };
  },
);

/**
 * Turn a relative `actionUrl` (e.g. `/finance/cash-advances/xxx` or
 * `/finance/budgets/xxx#br-yyy`) into an absolute one on the tenant's
 * subdomain. Adds `?from=email` before any `#fragment` so approval
 * Server Actions can log `via_email=true` audit context.
 *
 * URL RFC 3986 order: `path[?query][#fragment]`. Callers pass paths
 * with pre-existing fragments (e.g. budget request deep links) so we
 * must split on `#` first, insert the query, then re-append the fragment.
 * Otherwise we produce malformed URLs like `/foo#bar?from=email` where
 * the query is treated as part of the fragment and never sent to the
 * server as Referer.
 *
 * Returns undefined when there's no action to link to — the skeleton
 * hides the CTA in that case.
 */
function buildAbsoluteActionUrl(input: {
  slug: string;
  path?: string;
}): string | undefined {
  if (!input.path || !input.slug) return undefined;
  const root = getRootDomain();
  // In dev, `getRootDomain()` returns `localhost:PORT` — HTTP is fine.
  // In staging/prod, always HTTPS.
  const proto = root.startsWith("localhost") ? "http" : "https";
  const base = `${proto}://${input.slug}.${root}`;
  const hashIdx = input.path.indexOf("#");
  const pathAndQuery = hashIdx >= 0 ? input.path.slice(0, hashIdx) : input.path;
  const fragment = hashIdx >= 0 ? input.path.slice(hashIdx) : "";
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  return `${base}${pathAndQuery}${sep}from=email${fragment}`;
}
