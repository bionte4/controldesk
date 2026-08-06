import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import type { AuditActionType, Json } from "@/types/database";

/**
 * Records one row into `public.security_audit_logs` via the SECURITY INVOKER
 * `record_audit_log()` RPC (rules §3 / §17.3). The trigger + RLS combo on
 * that table makes the row immutable.
 *
 * `oldValues` / `newValues` are auto-redacted for well-known sensitive
 * columns before hitting the DB — even accidental logging cannot leak
 * PII / financial secrets.
 */

export type RecordAuditInput = {
  actionType: AuditActionType;
  resourceName: string;
  resourceId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

const SENSITIVE_KEYS = new Set([
  "password",
  "encrypted_password",
  "hashed_password",
  "salary",
  "base_salary",
  "gross_salary",
  "net_salary",
  "bank_account_number",
  "bank_account",
  "ktp_number",
  "npwp",
  "id_card_number",
  "otp",
  "totp",
  "access_token",
  "refresh_token",
  "service_role_key",
  "supabase_service_role_key",
  "api_key",
  "secret",
]);

function redact(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(redact) as Json;
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  // Dates, bigints, etc. — stringify.
  return String(value);
}

async function inferRequestContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  try {
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for");
    const ip =
      forwardedFor?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      h.get("cf-connecting-ip") ||
      null;
    return { ip, userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  const supabase = await createClient();
  const { ip, userAgent } = await inferRequestContext();

  const { error } = await supabase.rpc("record_audit_log", {
    p_action_type: input.actionType,
    p_resource_name: input.resourceName,
    p_resource_id: input.resourceId ?? undefined,
    p_old_values: input.oldValues ? redact(input.oldValues) : undefined,
    p_new_values: input.newValues ? redact(input.newValues) : undefined,
    p_metadata: input.metadata ? (redact(input.metadata) as Json) : undefined,
    p_ip_address: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  if (error) {
    // Audit failures are a hard error — we surface them so the caller can
    // decide whether to roll back the mutation.
    throw new Error(`audit log write failed: ${error.message}`);
  }
}
