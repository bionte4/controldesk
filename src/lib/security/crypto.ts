/**
 * ControlDesk — encryption + UI masking helpers (rules §3).
 *
 * Sensitive HRIS fields (`nik`, `bank_account_number`, `salary`, `npwp`,
 * etc.) MUST be encrypted at rest and MUST be masked in the UI for any
 * role that isn't HR / Finance / Admin.
 *
 * ## Active exports
 *
 *   1. `getEncryptionKey()` — reads `APP_ENCRYPTION_KEY`. Used by
 *      every downstream crypto module (`token-crypto`, `employee-pii`).
 *   2. `maskSensitive()` / `maskBankAccount()` / `maskSalary()` — pure
 *      UI helpers that hide all but the last N chars of a string. Use
 *      in cell renderers where the reader's role hasn't earned
 *      decryption rights.
 *   3. `canReadSensitive()` — role predicate. Combine with the PDP for
 *      full row-level + column-level control.
 *
 * ## Deprecated exports — DO NOT USE FOR NEW CODE
 *
 *   `encryptExpression()` / `decryptExpression()` — pgcrypto SQL
 *   fragment builders. Kept in-tree only as a historical reference.
 *   The pattern REQUIRED setting `app.enc_key` on every Postgres
 *   session GUC, which supabase-js pool cannot manage (see the
 *   rationale in migration 0042). Every new sensitive column now
 *   encrypts Node-side via one of:
 *
 *     - `token-crypto.ts` — opaque server-side secrets (OAuth tokens,
 *       third-party API keys). Not queryable.
 *     - `employee-pii.ts` — columnar user-facing PII with optional
 *       blind-index hash for equality lookups. NIK and
 *       bank_account_number go through this module.
 *
 *   If you find yourself reaching for `encryptExpression()`, stop and
 *   pick the appropriate Node-side module instead.
 *
 * The key itself is provisioned in `APP_ENCRYPTION_KEY` (documented in
 * `.env.local.example`). Rotation runbook: `docs/ops/secret-rotation.md`.
 */

import type { EmployeeRole } from "@/lib/rbac/roles";

// ---------------------------------------------------------------------------
// Key management.
// ---------------------------------------------------------------------------
export function getEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY is missing or too short (min 32 chars). Set it in .env.local / Docker secret.",
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// DEPRECATED: pgcrypto SQL fragment builders.
//
// These helpers were designed for a pattern where every Postgres session
// set `app.enc_key` via `set_config()` and the RPC inlined
// `pgp_sym_encrypt` / `pgp_sym_decrypt`. Migration 0042 abandoned this
// approach because Supabase's pooled PostgREST connections cannot
// reliably set session GUCs. Every subsequent sensitive column
// (google_calendar_credentials.encrypted_refresh_token, employees.nik,
// employees.bank_account_number) encrypts Node-side and stores the
// compact ciphertext (`v1.<iv>.<ct>.<tag>`) in a plain `text` column.
//
// The exports below are kept to avoid breaking any lingering
// callers, but they should NOT be used for new code. Prefer:
//
//   - `token-crypto.ts` for opaque secrets (OAuth tokens, API keys).
//   - `employee-pii.ts` for columnar HRIS PII with blind-index hash.
// ---------------------------------------------------------------------------

/** @deprecated Kept for historical reference; do not use in new code. */
export type SensitiveColumn = {
  /** Bare table column name that holds the ciphertext, e.g. `salary_enc`. */
  columnName: string;
  /** Postgres type to cast the decrypted value to, e.g. `numeric`, `text`. */
  postgresType: "text" | "numeric" | "integer" | "date";
};

/** @deprecated Use `token-crypto.ts` or `employee-pii.ts` instead. */
export function encryptExpression(paramPlaceholder: string): string {
  return `pgp_sym_encrypt(${paramPlaceholder}, current_setting('app.enc_key'))`;
}

/** @deprecated Use `token-crypto.ts` or `employee-pii.ts` instead. */
export function decryptExpression(col: SensitiveColumn): string {
  return `pgp_sym_decrypt(${col.columnName}::bytea, current_setting('app.enc_key'))::${col.postgresType} as ${col.columnName.replace(/_enc$/, "")}`;
}

// ---------------------------------------------------------------------------
// UI masking.
// ---------------------------------------------------------------------------
export type MaskOptions = {
  /** Chars from the end to reveal, default 4. */
  reveal?: number;
  /** Mask character, default `•` (U+2022). */
  maskChar?: string;
  /** Preserve exact length; else collapse into a fixed 8-char mask. */
  preserveLength?: boolean;
};

export function maskSensitive(
  value: string | number | null | undefined,
  options: MaskOptions = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const s = String(value);
  const reveal = Math.max(0, options.reveal ?? 4);
  const maskChar = options.maskChar ?? "•";
  const preserve = options.preserveLength ?? false;

  if (s.length <= reveal) {
    return preserve ? s : maskChar.repeat(s.length);
  }
  const visible = s.slice(-reveal);
  const hiddenCount = preserve ? s.length - reveal : 8;
  return `${maskChar.repeat(hiddenCount)}${visible}`;
}

export function maskBankAccount(value: string | null | undefined): string {
  return maskSensitive(value, { reveal: 4, preserveLength: true });
}

export function maskSalary(
  value: number | null | undefined,
  locale = "id-ID",
  currency = "IDR",
): string {
  if (value === null || value === undefined) return "—";
  // Salary displays are usually just "restricted" — never show digits at all
  // unless the actor is allowed.
  void locale;
  void currency;
  return "•• restricted";
}

// ---------------------------------------------------------------------------
// Role predicate.
//
// Accepts BOTH the legacy DB enum names and the canonical role names —
// the codebase is mid-migration (rules §6) and callers on either side
// need to reach this predicate. The union is deliberately over-broad
// (accepts `string`) at the type level to avoid coupling this helper
// to the canonical-role type file; enrolment into `SENSITIVE_READERS`
// is the actual source of truth.
// ---------------------------------------------------------------------------
const SENSITIVE_READERS: ReadonlySet<string> = new Set([
  // Legacy DB enum names — see supabase/migrations/0002 for the enum.
  "HR_ADMIN",
  "LEAD_FINANCE",
  "TENANT_ADMIN",
  // Canonical role names — see src/lib/rbac/roles.ts. FINANCE is the
  // canonical rename of LEAD_FINANCE; ADMIN of TENANT_ADMIN. There is
  // no canonical rename of HR_ADMIN yet — HR responsibility folds
  // into ADMIN, but we keep HR_ADMIN eligible for backward compat.
  "ADMIN",
  "FINANCE",
]);

export function canReadSensitive(role: EmployeeRole | string): boolean {
  return SENSITIVE_READERS.has(role);
}
