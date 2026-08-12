import "server-only";

import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Repository for tenant bot config + per-user chat links.
 *
 * The underlying tables have `no direct access` RLS policies (see
 * migration 0069), so we always go through the service-role client.
 * The service-role client bypasses RLS entirely, which is why every
 * public function in this file re-checks `tenantId` in its WHERE
 * clause — no implicit tenant scoping.
 */

export type TenantBotConfig = {
  tenantId: string;
  botUsername: string;
  botToken: string; // decrypted
  isActive: boolean;
  lastError: string | null;
};

export async function loadTenantBotConfig(
  tenantId: string,
): Promise<TenantBotConfig | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("tenant_telegram_bots")
    .select(
      "tenant_id, bot_username, encrypted_bot_token, is_active, last_error",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      tenantId: data.tenant_id,
      botUsername: data.bot_username,
      botToken: decryptToken(data.encrypted_bot_token),
      isActive: data.is_active,
      lastError: data.last_error,
    };
  } catch (err) {
    // Ciphertext unreadable — likely APP_ENCRYPTION_KEY rotated
    // without re-encryption. Surface as null so callers show "Bot
    // not configured" rather than crashing.
    return {
      tenantId: data.tenant_id,
      botUsername: data.bot_username,
      botToken: "",
      isActive: false,
      lastError:
        err instanceof Error
          ? `Bot token unreadable: ${err.message}`
          : "Bot token unreadable.",
    };
  }
}

export async function saveTenantBotConfig(input: {
  tenantId: string;
  botUsername: string;
  botToken: string; // plaintext
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("tenant_telegram_bots").upsert(
    {
      tenant_id: input.tenantId,
      bot_username: input.botUsername,
      encrypted_bot_token: encryptToken(input.botToken),
      is_active: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    throw new Error(
      `Failed to save Telegram bot for tenant ${input.tenantId}: ${error.message}`,
    );
  }
}

export async function deactivateTenantBot(
  tenantId: string,
  reason?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("tenant_telegram_bots")
    .update({
      is_active: false,
      last_error: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
}

export type UserTelegramLink = {
  tenantId: string;
  userId: string;
  chatId: string; // decrypted, kept as string because Telegram uses signed 64-bit ints
  displayName: string | null;
  telegramUsername: string | null;
  linkedAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
};

export async function loadUserLink(input: {
  tenantId: string;
  userId: string;
}): Promise<UserTelegramLink | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("user_telegram_links")
    .select(
      "tenant_id, user_id, encrypted_chat_id, display_name, telegram_username, linked_at, last_used_at, last_error",
    )
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      tenantId: data.tenant_id,
      userId: data.user_id,
      chatId: decryptToken(data.encrypted_chat_id),
      displayName: data.display_name,
      telegramUsername: data.telegram_username,
      linkedAt: data.linked_at,
      lastUsedAt: data.last_used_at,
      lastError: data.last_error,
    };
  } catch {
    return null;
  }
}

export async function saveUserLink(input: {
  tenantId: string;
  userId: string;
  chatId: string;
  displayName?: string | null;
  telegramUsername?: string | null;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("user_telegram_links").upsert(
    {
      tenant_id: input.tenantId,
      user_id: input.userId,
      encrypted_chat_id: encryptToken(input.chatId),
      display_name: input.displayName ?? null,
      telegram_username: input.telegramUsername ?? null,
      linked_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "tenant_id,user_id" },
  );
  if (error) {
    throw new Error(
      `Failed to save Telegram link for user ${input.userId}: ${error.message}`,
    );
  }
}

export async function removeUserLink(input: {
  tenantId: string;
  userId: string;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("user_telegram_links")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId);
}
