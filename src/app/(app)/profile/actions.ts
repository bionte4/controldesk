"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  encodeLinkToken,
  loadTenantBotConfig,
  loadUserLink,
  removeUserLink,
  sendTelegramTest,
} from "@/lib/integrations/telegram";
import {
  encodeWhatsAppLinkToken,
  loadTenantWhatsAppConfig,
  loadUserWhatsAppLink,
  removeUserWhatsAppLink,
  sendWhatsAppTest,
} from "@/lib/integrations/whatsapp";
import {
  resetPreferencesForUser,
  upsertPreferencesGrid,
  loadPreferencesForUser,
} from "@/lib/notifications/preferences";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { recordAudit } from "@/lib/security/audit";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/security/action-wrapper";
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
} from "@/lib/validation/profile";
import {
  restoreDefaultsSchema,
  updatePreferencesSchema,
  type RestoreDefaultsInput,
  type UpdatePreferencesInput,
} from "@/lib/validation/preferences";

/**
 * Compose the display `full_name` column from first/last so downstream
 * consumers that key off `full_name` (roster, timesheets, approvals) stay
 * consistent with the split fields.
 */
function composeFullName(first: string, last?: string | null): string {
  const clean = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return clean.join(" ");
}

/**
 * Self-service profile update — rules §6, PDP `decideEmployee` self branch.
 *
 * Scope: only fields listed in `updateProfileSchema` are writable here.
 * HR-managed attributes (role, salary, department, employment_type,
 * bank_account_number, ...) never leave the schema, so even if a client
 * smuggles them in the Zod validator drops them before the action runs.
 *
 * The PDP call resolves to ALLOW because `ownerEmployeeId === actor.employeeId`
 * — no drift with HR paths. Audit trail records the diff.
 */
export const updateProfileAction = withSecureAction({
  schema: updateProfileSchema,
  resource: "employee",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "employees",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    ownerEmployeeId: ctx.actor.employeeId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: before, error: readErr } = await supabase
      .from("employees")
      .select(
        "id, first_name, last_name, full_name, phone, date_of_birth, preferred_locale",
      )
      .eq("id", ctx.actor.employeeId)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !before) {
      throw new Error(readErr?.message ?? "Employee record not found.");
    }

    const fullName = composeFullName(input.first_name, input.last_name);
    if (!fullName) {
      throw new Error("First name is required.");
    }

    const { data: after, error: updErr } = await supabase
      .from("employees")
      .update({
        first_name: input.first_name,
        last_name: input.last_name ?? null,
        full_name: fullName,
        phone: input.phone ?? null,
        date_of_birth: input.date_of_birth ?? null,
        preferred_locale: input.preferred_locale ?? null,
      })
      .eq("id", ctx.actor.employeeId)
      .eq("tenant_id", ctx.actor.tenantId)
      .select(
        "id, first_name, last_name, full_name, phone, date_of_birth, preferred_locale",
      )
      .single();
    if (updErr || !after) {
      throw new Error(updErr?.message ?? "Failed to update profile.");
    }

    // Reflect the locale choice in the visible cookie so the very next
    // render uses the user's preferred language without waiting for the
    // topbar toggle. TTL = 1 year to match rules §18 (i18n hygiene).
    if (input.preferred_locale) {
      const jar = await cookies();
      jar.set("NEXT_LOCALE", input.preferred_locale, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }

    revalidatePath("/profile");

    return {
      result: after,
      auditResourceId: after.id,
      auditOldValues: before,
      auditNewValues: after,
    };
  },
});

/**
 * Change the user's Supabase Auth password.
 *
 * This does NOT go through `withSecureAction` because:
 *   1. Passwords never touch the `employees` table — they live in
 *      `auth.users`, so there is nothing to snapshot for a diff-style audit.
 *   2. Verifying the current password requires a fresh `signInWithPassword`
 *      call which the PDP contract does not model.
 *
 * We still record an audit row manually (action_type=UPDATE, resource_name=
 * auth.users, no payload) so account takeovers leave a trail per rules §3.
 */
export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<ActionResult<{ ok: true }>> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      reason:
        parsed.error.issues[0]?.message ?? "Password payload is invalid.",
    };
  }
  const { current_password, new_password } = parsed.data;

  const employee = await requireCurrentEmployee();
  const supabase = await createClient();

  // 1. Verify the current password by attempting a fresh sign-in. Supabase
  //    rotates the session on success — which is what we want anyway.
  const { error: reauthErr } = await supabase.auth.signInWithPassword({
    email: employee.email,
    password: current_password,
  });
  if (reauthErr) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Current password is incorrect.",
    };
  }

  // 2. Update to the new password. Supabase Auth enforces its own rate
  //    limits and prohibits reusing the last N passwords when configured
  //    at the project level — we do not need to duplicate that here.
  const { error: updErr } = await supabase.auth.updateUser({
    password: new_password,
  });
  if (updErr) {
    return {
      ok: false,
      code: "INTERNAL",
      reason: updErr.message ?? "Failed to update password.",
    };
  }

  // 3. Audit — no payload; we NEVER log password material.
  try {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "auth.users",
      resourceId: employee.user_id,
      metadata: { event: "password_change" },
    });
  } catch {
    // Password already rotated; a broken audit row cannot be un-done. We
    // surface a soft failure so the user knows to notify HR / IT, but do
    // not block: rules §3 accepts audit failure as an operational alert.
    return {
      ok: false,
      code: "AUDIT_FAILED",
      reason:
        "Password was updated, but the audit trail could not be written. Please contact HR / IT.",
    };
  }

  return { ok: true, data: { ok: true } };
}

/**
 * Save the user's notification preferences. Applies the delta list
 * on top of the current grid so partial updates work — callers can
 * send just the toggles that flipped.
 *
 * PDP: this touches `user_notification_preferences`, which is scoped
 * to `auth.uid()` via RLS. There is no "read someone else's prefs"
 * path — everyone edits their own, so we don't route through
 * `withSecureAction`'s PDP layer (it would just no-op). Audit is
 * still written manually per rules §3.
 */
export async function updatePreferencesAction(
  input: UpdatePreferencesInput,
): Promise<ActionResult<{ ok: true }>> {
  const parsed = updatePreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      reason:
        parsed.error.issues[0]?.message ?? "Preferences payload is invalid.",
    };
  }
  const employee = await requireCurrentEmployee();

  // Read current grid, apply diffs on top, write full grid back. The
  // full-grid write is safe because RLS gates on user_id — an attacker
  // can't smuggle another user's row through the batch payload.
  const grid = await loadPreferencesForUser({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
  });
  for (const t of parsed.data.toggles) {
    // The schema uses z.enum(readonly string tuple), so TS keeps the
    // narrow type. But the tuple is derived from a mutable readonly
    // array — safe to index-cast to our NotificationCategory /
    // NotificationChannel literals.
    grid[
      t.category as keyof typeof grid
    ][t.channel as keyof (typeof grid)[keyof typeof grid]] = t.enabled;
  }
  const res = await upsertPreferencesGrid({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
    grid,
  });
  if (!res.ok) {
    return {
      ok: false,
      code: "INTERNAL",
      reason: res.error,
    };
  }

  try {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "user_notification_preferences",
      resourceId: employee.user_id,
      metadata: {
        toggles_count: parsed.data.toggles.length,
      },
    });
  } catch {
    // Preferences already persisted — audit hiccup should not block
    // the UX. Rules §3 permits soft failure with operational alert.
  }

  revalidatePath("/profile");
  return { ok: true, data: { ok: true } };
}

/**
 * Restore preferences to their default (all channels ON) by deleting
 * the user's rows — the dispatcher treats absence as ALLOW.
 */
export async function restorePreferencesDefaultsAction(
  input: RestoreDefaultsInput,
): Promise<ActionResult<{ ok: true }>> {
  const parsed = restoreDefaultsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      reason:
        parsed.error.issues[0]?.message ??
        "Restore-defaults request is invalid.",
    };
  }
  const employee = await requireCurrentEmployee();

  const res = await resetPreferencesForUser({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
  });
  if (!res.ok) {
    return { ok: false, code: "INTERNAL", reason: res.error };
  }

  try {
    await recordAudit({
      actionType: "DELETE",
      resourceName: "user_notification_preferences",
      resourceId: employee.user_id,
      metadata: { event: "restore_defaults" },
    });
  } catch {
    // See above — soft failure only.
  }

  revalidatePath("/profile");
  return { ok: true, data: { ok: true } };
}

// ---------------------------------------------------------------------------
// Telegram integration actions (Phase 2).
// ---------------------------------------------------------------------------

/**
 * Build the deep link the user clicks to link their personal Telegram
 * chat. Format: `https://t.me/<bot_username>?start=<signed_token>`.
 *
 * Returns `{ok:false}` when the tenant hasn't configured a bot — the
 * UI surfaces "Bot not configured" hint in that state.
 */
export async function generateTelegramLinkAction(): Promise<
  ActionResult<{ url: string; botUsername: string; expiresAt: number }>
> {
  const employee = await requireCurrentEmployee();

  const bot = await loadTenantBotConfig(employee.tenant_id);
  if (!bot || !bot.isActive || !bot.botUsername) {
    return {
      ok: false,
      code: "PRECONDITION",
      reason: "Tenant has not configured a Telegram bot yet.",
    };
  }

  const ttlSeconds = 15 * 60;
  const token = encodeLinkToken({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
    ttlSeconds,
  });
  const url = `https://t.me/${bot.botUsername}?start=${encodeURIComponent(token)}`;

  return {
    ok: true,
    data: {
      url,
      botUsername: bot.botUsername,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    },
  };
}

/**
 * Send a "Telegram is linked" test message to the user's linked chat.
 * Uses their `preferred_locale` for message text.
 */
export async function sendTelegramTestAction(): Promise<
  ActionResult<{ ok: true }>
> {
  const employee = await requireCurrentEmployee();

  const locale: "id" | "en" =
    employee.preferred_locale === "en" ? "en" : "id";

  const res = await sendTelegramTest({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
    locale,
  });
  if (!res.ok) {
    return {
      ok: false,
      code:
        res.code === "NO_LINK" || res.code === "NO_BOT"
          ? "PRECONDITION"
          : "INTERNAL",
      reason: res.error,
    };
  }

  try {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "user_telegram_links",
      resourceId: employee.user_id,
      metadata: { event: "test_message_sent" },
    });
  } catch {
    // Soft failure — the message was delivered, that's what matters.
  }

  return { ok: true, data: { ok: true } };
}

/**
 * Unlink the user's Telegram chat. Idempotent — safe to call even if
 * no link exists.
 */
export async function unlinkTelegramAction(): Promise<
  ActionResult<{ ok: true }>
> {
  const employee = await requireCurrentEmployee();

  const existing = await loadUserLink({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
  });

  await removeUserLink({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
  });

  try {
    await recordAudit({
      actionType: "DELETE",
      resourceName: "user_telegram_links",
      resourceId: employee.user_id,
      metadata: {
        event: "telegram_unlinked",
        had_link: !!existing,
      },
    });
  } catch {
    // Soft failure — link removed either way.
  }

  revalidatePath("/profile");
  return { ok: true, data: { ok: true } };
}

// ---------------------------------------------------------------------------
// WhatsApp integration actions (Phase A — linking + Send test only).
// ---------------------------------------------------------------------------

/**
 * Build the WhatsApp click-to-chat deep link. Format:
 *   `https://wa.me/<business_phone>?text=/start%20<signed_token>`
 *
 * User taps the link → WhatsApp opens the tenant's business chat
 * with `/start <token>` pre-filled → they hit Send → our webhook
 * receives the message, verifies the token, saves the link.
 *
 * Returns `{ok:false}` when the tenant hasn't configured WhatsApp —
 * the UI surfaces "Not configured" hint in that state.
 */
export async function generateWhatsAppLinkAction(): Promise<
  ActionResult<{ url: string; businessPhone: string; expiresAt: number }>
> {
  const employee = await requireCurrentEmployee();

  const cfg = await loadTenantWhatsAppConfig(employee.tenant_id);
  if (!cfg || !cfg.isActive || !cfg.phoneNumberId) {
    return {
      ok: false,
      code: "PRECONDITION",
      reason: "Tenant has not configured WhatsApp yet.",
    };
  }

  const ttlSeconds = 15 * 60;
  const token = encodeWhatsAppLinkToken({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
    ttlSeconds,
  });

  // Strip `whatsapp:` prefix and `+` sign — `wa.me/<digits>` expects
  // an unprefixed E.164 without the leading plus.
  const digits = cfg.phoneNumberId
    .replace(/^whatsapp:/, "")
    .replace(/^\+/, "");
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(
    `/start ${token}`,
  )}`;

  return {
    ok: true,
    data: {
      url,
      businessPhone: digits,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    },
  };
}

/**
 * Send a "WhatsApp is linked" test message to the user's linked
 * number, using their `preferred_locale` for the message text.
 */
export async function sendWhatsAppTestAction(): Promise<
  ActionResult<{ ok: true }>
> {
  const employee = await requireCurrentEmployee();

  const locale: "id" | "en" =
    employee.preferred_locale === "en" ? "en" : "id";

  const res = await sendWhatsAppTest({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
    locale,
  });
  if (!res.ok) {
    return {
      ok: false,
      code:
        res.code === "NO_LINK" ||
        res.code === "NO_CONFIG" ||
        res.code === "NOT_IMPLEMENTED"
          ? "PRECONDITION"
          : "INTERNAL",
      reason: res.error,
    };
  }

  try {
    await recordAudit({
      actionType: "UPDATE",
      resourceName: "user_whatsapp_links",
      resourceId: employee.user_id,
      metadata: { event: "test_message_sent" },
    });
  } catch {
    // Soft failure — message was delivered.
  }

  return { ok: true, data: { ok: true } };
}

/**
 * Unlink the user's WhatsApp number. Idempotent — safe to call even
 * if no link exists.
 */
export async function unlinkWhatsAppAction(): Promise<
  ActionResult<{ ok: true }>
> {
  const employee = await requireCurrentEmployee();

  const existing = await loadUserWhatsAppLink({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
  });

  await removeUserWhatsAppLink({
    tenantId: employee.tenant_id,
    userId: employee.user_id,
  });

  try {
    await recordAudit({
      actionType: "DELETE",
      resourceName: "user_whatsapp_links",
      resourceId: employee.user_id,
      metadata: {
        event: "whatsapp_unlinked",
        had_link: !!existing,
      },
    });
  } catch {
    // Soft failure — link removed either way.
  }

  revalidatePath("/profile");
  return { ok: true, data: { ok: true } };
}
