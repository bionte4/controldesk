import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { encryptToken } from "@/lib/security/token-crypto";
import type { Database } from "@/types/database";

/**
 * Store (or replace) a tenant's Google Calendar OAuth refresh token.
 *
 * The plaintext token is encrypted Node-side via AES-256-GCM
 * (`src/lib/security/token-crypto.ts`) before it lands in Postgres. RLS
 * on `google_calendar_credentials` forbids any principal other than
 * `service_role`, so this helper must be called from a server action or
 * route handler that uses `createServiceRoleClient()`.
 *
 * Typical wire-up:
 *   1. Tenant admin clicks "Connect Google Calendar" → OAuth consent.
 *   2. `/api/integrations/google/callback` receives the auth code,
 *      exchanges it for tokens, then calls `saveTenantGoogleCredentials`.
 *   3. Rows in `project_calendar_events` for that tenant start draining
 *      through the real publisher within 10 minutes.
 */
export async function saveTenantGoogleCredentials(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string;
    refreshToken: string;
    calendarId?: string;
    clientEmail?: string | null;
  },
): Promise<void> {
  const encrypted = encryptToken(args.refreshToken);
  const { error } = await supabase
    .from("google_calendar_credentials")
    .upsert(
      {
        tenant_id: args.tenantId,
        calendar_id: args.calendarId ?? "primary",
        client_email: args.clientEmail ?? null,
        encrypted_refresh_token: encrypted,
        is_active: true,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
  if (error) {
    throw new Error(
      `Failed to save Google credentials for tenant ${args.tenantId}: ${error.message}`,
    );
  }
}

/**
 * Deactivate (soft-delete) a tenant's stored credentials. Used when an
 * admin revokes the integration or when Google returns an
 * `invalid_grant` — keeping the row lets us surface `last_error` in the
 * admin UI without immediately dropping historical outbox references.
 */
export async function deactivateTenantGoogleCredentials(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  lastError?: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_calendar_credentials")
    .update({
      is_active: false,
      last_error: lastError ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
  if (error) {
    throw new Error(
      `Failed to deactivate Google credentials for tenant ${tenantId}: ${error.message}`,
    );
  }
}
