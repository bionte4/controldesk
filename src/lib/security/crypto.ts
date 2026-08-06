/**
 * ControlDesk — encryption + UI masking helpers (rules §3).
 *
 * Sensitive HRIS fields (`salary`, `bank_account_number`, `npwp`, `ktp`,
 * etc.) MUST be encrypted at rest with pgcrypto's symmetric AES and
 * MUST be masked in the UI for any role that isn't HR / Finance / Admin.
 *
 * This file exposes:
 *
 *   1. `encryptedInsert()` / `decryptSelect()` — SQL fragment builders that
 *      inline `pgp_sym_encrypt` / `pgp_sym_decrypt` with the tenant
 *      encryption key. Keeps the ciphertext in Postgres so RLS still
 *      applies.
 *   2. `maskSensitive()` — pure UI helper that hides all but the last
 *      characters of a string. Use in cell renderers where the reader's
 *      role hasn't earned decryption rights.
 *   3. `canReadSensitive()` — role predicate. Combine with the PDP for
 *      full row-level + column-level control.
 *
 * The key itself is provisioned in `APP_ENCRYPTION_KEY` (documented in
 * `.env.local.example`). Rotate by running a controlled re-encryption
 * migration; never re-use the same key across environments.
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
// SQL fragment builders.
//
// Usage inside a Supabase RPC / SQL migration:
//
//   -- Store
//   insert into employee_hr_profile (employee_id, salary_enc)
//   values ($1, pgp_sym_encrypt($2, current_setting('app.enc_key')));
//
//   -- Read
//   select
//     employee_id,
//     pgp_sym_decrypt(salary_enc::bytea, current_setting('app.enc_key'))::numeric as salary
//   from employee_hr_profile;
//
// The Node runtime never sees the key — it's set as a Postgres session GUC
// (via `set_config('app.enc_key', ...)` at the start of each transaction
// that needs it). This helper only formats those SQL calls.
// ---------------------------------------------------------------------------

export type SensitiveColumn = {
  /** Bare table column name that holds the ciphertext, e.g. `salary_enc`. */
  columnName: string;
  /** Postgres type to cast the decrypted value to, e.g. `numeric`, `text`. */
  postgresType: "text" | "numeric" | "integer" | "date";
};

export function encryptExpression(
  paramPlaceholder: string,
): string {
  return `pgp_sym_encrypt(${paramPlaceholder}, current_setting('app.enc_key'))`;
}

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
// ---------------------------------------------------------------------------
const SENSITIVE_READERS: readonly EmployeeRole[] = [
  "HR_ADMIN",
  "LEAD_FINANCE",
  "TENANT_ADMIN",
] as const;

export function canReadSensitive(role: EmployeeRole): boolean {
  return SENSITIVE_READERS.includes(role);
}
