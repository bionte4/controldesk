import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

import { getEncryptionKey } from "./crypto";

/**
 * Symmetric encryption for opaque server-side secrets (rules §3).
 *
 * Use this helper for tokens the runtime itself needs to read at
 * dispatch time (OAuth refresh tokens, third-party API keys). For
 * *columnar* encryption of user-facing PII (`employees.salary`,
 * `bank_account_number`), keep using the pgcrypto pattern in
 * `crypto.ts` so tenant admins can hold their own encryption ceremony.
 *
 * Algorithm: AES-256-GCM.
 *   * Key is derived from `APP_ENCRYPTION_KEY` via HKDF-SHA256 with a
 *     compile-time info string. Rotating `APP_ENCRYPTION_KEY` invalidates
 *     all ciphertexts encrypted with the previous key — coordinate with
 *     the secret-rotation runbook (rules §22 90-day rotation).
 *   * 96-bit IV generated per encryption (cryptographically random).
 *   * 128-bit auth tag appended.
 *
 * Wire format: `v1.<b64u iv>.<b64u ciphertext>.<b64u tag>` — the leading
 * `v1.` prefix lets us add v2 (envelope encryption / KMS) without a data
 * migration.
 */

const KDF_INFO = "controldesk/v1/token-crypto";
const VERSION = "v1";

function deriveKey(): Buffer {
  const master = getEncryptionKey();
  // 32 bytes = 256 bits for AES-256. No salt — the master key is already
  // sufficiently long; HKDF's info string prevents cross-purpose reuse.
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), KDF_INFO, 32));
}

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

export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: plaintext must be a non-empty string");
  }
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64u(iv), b64u(ct), b64u(tag)].join(".");
}

export function decryptToken(payload: string): string {
  if (typeof payload !== "string" || !payload.startsWith(`${VERSION}.`)) {
    throw new Error(
      `decryptToken: unknown ciphertext version (expected ${VERSION})`,
    );
  }
  const parts = payload.split(".");
  if (parts.length !== 4) {
    throw new Error("decryptToken: malformed ciphertext");
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const key = deriveKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    b64uDecode(ivB64!),
  );
  decipher.setAuthTag(b64uDecode(tagB64!));
  const plain = Buffer.concat([
    decipher.update(b64uDecode(ctB64!)),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

// Exposed for unit tests.
export const __internals = { deriveKey, KDF_INFO, VERSION };
