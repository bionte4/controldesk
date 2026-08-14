import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "crypto";

import { getEncryptionKey } from "./crypto";

/**
 * Columnar encryption for employee PII (rules §3).
 *
 * The `bank_account_number` and `nik` fields on `public.employees`
 * are stored as compact ciphertext:
 *
 *   v1.<b64u iv>.<b64u ciphertext>.<b64u tag>
 *
 * ...and (for NIK only) accompanied by a deterministic HMAC-SHA256
 * blind index so a `(tenant_id, nik_hash)` unique constraint can
 * catch duplicate entries without the DB ever seeing plaintext.
 *
 * ## Why a dedicated module (not `token-crypto.ts`)?
 *
 * The existing `token-crypto.ts` was purpose-built for opaque
 * server-side secrets — OAuth refresh tokens, third-party API
 * keys — that the RUNTIME reads at dispatch time. Employee PII
 * has different threat properties:
 *
 *   - It's user-facing (the HR admin needs to READ and RE-DISPLAY it).
 *   - It's queryable — HR does look-ups by NIK to check duplicates.
 *   - It has retention rules — cleared on anonymize (0016 helper).
 *
 * Reusing the same derived key would let an attacker who exfiltrated
 * one OAuth refresh token AND one encrypted NIK attempt cross-domain
 * confusion attacks (e.g. tricking the app into treating a NIK
 * ciphertext as an OAuth token). HKDF's `info` string is the
 * cheapest domain-separation available — bumping this file's
 * `KDF_INFO` to a different literal gives us two mutually-incompatible
 * key streams for free.
 *
 * ## Algorithm
 *
 *   - Encryption key: AES-256-GCM (12-byte IV, 16-byte tag).
 *   - Key derivation: HKDF-SHA256 over `APP_ENCRYPTION_KEY` with
 *     `info = "controldesk/v1/employee-pii/enc"`.
 *   - Blind index: HMAC-SHA256 over trimmed plaintext with
 *     `info = "controldesk/v1/employee-pii/hash"`.
 *   - Wire format is IDENTICAL to token-crypto (`v1.<iv>.<ct>.<tag>`)
 *     so the on-disk shape is portable across modules — the ONLY
 *     difference is the derived key.
 *
 * ## Non-goals
 *
 *   - We do NOT try to be searchable by ranges (no ORE / OPE).
 *   - We do NOT hide value length precisely — the wire format leaks
 *     ciphertext size, which for NIK is a fixed 16 bytes anyway.
 *   - We do NOT use envelope encryption (no per-tenant KEK). Rules
 *     §22 mandates 90-day rotation of `APP_ENCRYPTION_KEY`, which
 *     effectively invalidates every ciphertext and forces a re-encrypt.
 *     A future v2 could layer per-tenant KEKs.
 *
 * ## Key rotation
 *
 * Rotating `APP_ENCRYPTION_KEY` invalidates every existing NIK /
 * bank_account_number in the DB — decrypt will throw with the
 * GCM tag-mismatch error. Coordinate rotation via the runbook in
 * `docs/ops/secret-rotation.md`: (1) dual-write with both keys, (2)
 * one-off re-encrypt job, (3) drop the old key.
 */

const VERSION = "v1";
const ENC_KDF_INFO = "controldesk/v1/employee-pii/enc";
const HASH_KDF_INFO = "controldesk/v1/employee-pii/hash";

function b64u(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64uDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function deriveEncKey(): Buffer {
  const master = getEncryptionKey();
  // 32 bytes = 256 bits for AES-256. No salt — the master key is already
  // sufficiently long; HKDF's `info` string prevents cross-purpose reuse.
  return Buffer.from(
    hkdfSync("sha256", master, Buffer.alloc(0), ENC_KDF_INFO, 32),
  );
}

function deriveHashKey(): Buffer {
  const master = getEncryptionKey();
  return Buffer.from(
    hkdfSync("sha256", master, Buffer.alloc(0), HASH_KDF_INFO, 32),
  );
}

/**
 * Encrypt an employee PII string. Empty / whitespace-only input
 * returns `null` so callers can round-trip "field unset" without
 * a special-case branch.
 */
export function encryptEmployeePii(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) return null;

  const key = deriveEncKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64u(iv), b64u(ct), b64u(tag)].join(".");
}

/**
 * Decrypt an employee PII ciphertext. Returns `null` if the input
 * is null/empty. Throws if the ciphertext is malformed or the GCM
 * tag doesn't verify — do NOT catch and swallow; a mismatch means
 * the row is either tampered or encrypted under a different master
 * key (post-rotation).
 */
export function decryptEmployeePii(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined) return null;
  if (ciphertext.length === 0) return null;

  if (!ciphertext.startsWith(`${VERSION}.`)) {
    throw new Error(
      `decryptEmployeePii: unknown ciphertext version (expected ${VERSION})`,
    );
  }
  const parts = ciphertext.split(".");
  if (parts.length !== 4) {
    throw new Error("decryptEmployeePii: malformed ciphertext");
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const key = deriveEncKey();
  const decipher = createDecipheriv("aes-256-gcm", key, b64uDecode(ivB64!));
  decipher.setAuthTag(b64uDecode(tagB64!));
  const plain = Buffer.concat([
    decipher.update(b64uDecode(ctB64!)),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

/**
 * Deterministic blind index for NIK equality checks.
 *
 * Uses HMAC-SHA256 with a derived key that is DIFFERENT from the
 * encryption key — same master, different HKDF `info` string.
 * Attacker in possession of the DB (encrypted NIKs + hashes) cannot
 * derive the plaintext without the master key.
 *
 * Given the master key IS also required to decrypt, the hash-derived
 * key never provides additional confidentiality — its role is purely
 * to give the DB a stable equality signal for `UNIQUE(tenant_id,
 * nik_hash)` and for HR duplicate-check queries.
 *
 * We namespace by tenant_id inside the HMAC input so the same NIK
 * across two tenants produces DIFFERENT hashes — this way a stolen
 * hash set can't be cross-referenced across tenants (limits scope
 * of a leak).
 *
 * Returns `null` when input is empty so callers can pass through
 * "field unset" without branching.
 */
export function hashEmployeeNik(input: {
  nik: string | null | undefined;
  tenantId: string;
}): Buffer | null {
  if (input.nik === null || input.nik === undefined) return null;
  const trimmed = input.nik.trim();
  if (trimmed.length === 0) return null;

  const key = deriveHashKey();
  const hmac = createHmac("sha256", key);
  // Include the tenant_id as a scope prefix so cross-tenant hash
  // matching is impossible. Byte separator `\x00` guards against
  // collision attacks (e.g. tenantA + "1234" vs tenantA1 + "234").
  hmac.update(input.tenantId);
  hmac.update(Buffer.from([0]));
  hmac.update(trimmed);
  return hmac.digest();
}

/**
 * Constant-time comparison for NIK hashes. Use this whenever the
 * server needs to check whether a submitted NIK matches an existing
 * hash, rather than fetching the ciphertext and decrypting.
 *
 * Guards against timing side channels — critical if the check
 * result eventually leaks via a response-time delta (e.g. the
 * duplicate-NIK-error branch takes longer than the happy path).
 */
export function nikHashesEqual(a: Buffer | null, b: Buffer | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Convert a Node Buffer to Postgres bytea's textual `\x<hex>` form,
 * which is what supabase-js sends over the JSON wire when writing
 * to a `bytea` column. Passing a raw Buffer causes supabase-js to
 * JSON-stringify it into `{"type":"Buffer","data":[...]}` which
 * won't cast to bytea at ingest.
 *
 * Passing `null` round-trips as `null` so callers can uniformly
 * push "field unset" without a branch.
 */
export function toBytea(buf: Buffer | null): string | null {
  if (buf === null) return null;
  return `\\x${buf.toString("hex")}`;
}

/**
 * Parse Postgres bytea's textual form back into a Node Buffer.
 * Handles both `\x<hex>` (default in Supabase JSON output) and
 * raw hex without prefix as a defensive fallback.
 */
export function fromBytea(s: string | null | undefined): Buffer | null {
  if (s === null || s === undefined) return null;
  const hex = s.startsWith("\\x") ? s.slice(2) : s;
  if (hex.length === 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`fromBytea: invalid hex payload (len=${hex.length})`);
  }
  return Buffer.from(hex, "hex");
}

// Exposed for unit tests. Do NOT import at runtime.
export const __internals = {
  deriveEncKey,
  deriveHashKey,
  ENC_KDF_INFO,
  HASH_KDF_INFO,
  VERSION,
};
