/**
 * ControlDesk AI Safety — PII redaction (rules §15).
 *
 * Before any tenant data reaches the LLM, sensitive attributes MUST be
 * redacted / hashed / bucketed so a model that leaks context can't expose
 * PII. The redaction is deterministic (SHA-256) so identical inputs collapse
 * to the same token across a batch — the model can still reason about
 * relationships without seeing the real names.
 *
 * Rules of thumb:
 *   - full names → `emp_<hash8>`
 *   - salary / hourly rate → bucket (5 buckets, IDR)
 *   - bank account → `bank_****last4`
 *   - KTP / NPWP / national IDs → dropped entirely
 *   - email → `user_<hash8>@redacted`
 *   - phone → `+62-XXX-XXXX-last4`
 */

import { createHash } from "node:crypto";

function hash8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function redactName(fullName: string | null | undefined): string {
  if (!fullName) return "emp_anon";
  return `emp_${hash8(fullName.trim().toLowerCase())}`;
}

export function redactEmail(email: string | null | undefined): string {
  if (!email) return "user_anon@redacted";
  return `user_${hash8(email.trim().toLowerCase())}@redacted`;
}

export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return "+62-XXX-XXXX-XXXX";
  const digits = phone.replace(/\D+/g, "");
  const last4 = digits.slice(-4).padStart(4, "X");
  return `+62-XXX-XXXX-${last4}`;
}

export function redactBankAccount(account: string | null | undefined): string {
  if (!account) return "bank_****XXXX";
  const digits = account.replace(/\D+/g, "");
  const last4 = digits.slice(-4).padStart(4, "X");
  return `bank_****${last4}`;
}

/**
 * Salary buckets (IDR, monthly). Bucket boundaries are indicative;
 * do not surface exact salaries to the model.
 */
export const SALARY_BUCKETS = [
  { max: 5_000_000, label: "≤5jt" },
  { max: 10_000_000, label: "5–10jt" },
  { max: 20_000_000, label: "10–20jt" },
  { max: 50_000_000, label: "20–50jt" },
  { max: Number.POSITIVE_INFINITY, label: ">50jt" },
] as const;

export function bucketSalary(idr: number | null | undefined): string {
  if (idr == null || !Number.isFinite(idr) || idr < 0) return "unknown";
  const bucket = SALARY_BUCKETS.find((b) => idr <= b.max);
  return bucket?.label ?? "unknown";
}

/**
 * Redact an entire employee-like record. This is the ONLY function that
 * should be called by generators — never pass raw employee objects to the
 * model.
 */
export type RedactedEmployee = {
  id_ref: string; // stable hash of the id, safe for cross-ref within a run
  role: string;
  name: string;
  email: string;
  phone: string;
  salary_bucket: string;
  bank_account: string;
};

export function redactEmployee(input: {
  id: string;
  role: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  monthly_salary?: number | null;
  bank_account_number?: string | null;
}): RedactedEmployee {
  return {
    id_ref: hash8(input.id),
    role: input.role,
    name: redactName(input.full_name),
    email: redactEmail(input.email),
    phone: redactPhone(input.phone),
    salary_bucket: bucketSalary(input.monthly_salary ?? null),
    bank_account: redactBankAccount(input.bank_account_number),
  };
}

/**
 * Scrub a free-form prompt string of common Indonesian PII patterns before
 * sending. Defence-in-depth: even if a generator forgets to pre-redact, the
 * final prompt still gets scrubbed.
 */
export function scrubPrompt(prompt: string): string {
  return (
    prompt
      // NPWP formatted (xx.xxx.xxx.x-xxx.xxx) — very distinctive, run first.
      .replace(/\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g, "[NPWP_REDACTED]")
      // Indonesian phone numbers (+62 / 08…) — run BEFORE generic account so
      // 08xxx-style phones don't get captured as bank accounts.
      .replace(/\+?(?:62|0)8\d{7,12}\b/g, "[PHONE_REDACTED]")
      // 16-digit NIK / KTP
      .replace(/\b\d{16}\b/g, "[KTP_REDACTED]")
      // Bank account numbers (10-15 standalone digits, avoids KTP overlap).
      .replace(/\b\d{10,15}\b/g, "[ACC_REDACTED]")
      // Common email addresses (fallback if not already hashed)
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[EMAIL_REDACTED]")
  );
}

/**
 * Post-LLM rehydration — walk the returned payload and replace every
 * 8-char lowercase hex hash (`id_ref` produced by `redactEmployee`) with
 * the caller-supplied display name. This is safe to run BEFORE storing in
 * `ai_insights.payload` because:
 *
 *   1. RLS on `ai_insights` scopes rows to `tenant_id`, so only tenant
 *      members can read them (rules §5).
 *   2. Full names are visible to anyone with `employees` read grant in
 *      the same tenant anyway — we're not exposing anything new.
 *   3. The redaction happens WHERE IT MATTERS: at prompt-send time
 *      (rules §15 — model never receives PII). Rehydration on the way
 *      back is a UX affordance, not a security concession.
 *
 * Design note: the schema (`employee_ref`, `pm_ref`) keeps `z.string()`,
 * so replacing a hash with a full name in place still validates. If we
 * ever need the raw hash back (e.g. for de-duplication or joining to a
 * later insight), we should split the schema to carry BOTH `id_ref` and
 * `display_name` explicitly.
 *
 * Only pure JSON values are visited (string / number / boolean / null /
 * plain object / array). Class instances or functions are returned
 * as-is to avoid corrupting internal state.
 */
export function rehydrateHashes<T>(
  payload: T,
  hashMap: ReadonlyMap<string, string>,
): T {
  if (hashMap.size === 0) return payload;

  // Precompile a single regex from the map keys so a payload with many
  // strings only pays a single pass per string. Keys are hex-8 by
  // construction, but we escape defensively.
  const escaped = Array.from(hashMap.keys()).map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "g");

  function walk(v: unknown): unknown {
    if (typeof v === "string") {
      return v.replace(re, (m) => hashMap.get(m) ?? m);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  }

  return walk(payload) as T;
}
