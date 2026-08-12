import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

import { getEncryptionKey } from "@/lib/security/crypto";

/**
 * Signed deep-link token for the Telegram `/start <token>` flow.
 *
 * Format (URL-safe base64): `<b64u(payload)>.<b64u(sig)>`
 *   * payload = `${tenantId}|${userId}|${expiresAtEpochSeconds}`
 *   * sig     = HMAC-SHA256(payload, APP_ENCRYPTION_KEY)
 *
 * Signed instead of encrypted because Telegram forwards the token
 * verbatim to our webhook — the server only needs to verify it wasn't
 * forged, not hide it from the user. Encrypting would waste bytes.
 *
 * TTL: 15 minutes. Users should click the deep link soon after
 * generating; if they wait, the Preferences UI can regenerate.
 */

const DEFAULT_TTL_SECONDS = 15 * 60;

function b64u(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function fromB64u(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replaceAll("-", "+").replaceAll("_", "/") + pad, "base64");
}

function sign(payload: string): string {
  const key = getEncryptionKey();
  return b64u(createHmac("sha256", key).update(payload).digest());
}

export function encodeLinkToken(input: {
  tenantId: string;
  userId: string;
  ttlSeconds?: number;
}): string {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${input.tenantId}|${input.userId}|${exp}`;
  const encodedPayload = b64u(Buffer.from(payload, "utf8"));
  const sig = sign(payload);
  return `${encodedPayload}.${sig}`;
}

export type DecodedLinkToken =
  | { ok: true; tenantId: string; userId: string; expiresAt: number }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

export function decodeLinkToken(token: string): DecodedLinkToken {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "MALFORMED" };
  const [encodedPayload, sig] = parts;

  let payload: string;
  try {
    payload = fromB64u(encodedPayload).toString("utf8");
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  const expected = sign(payload);
  // constant-time comparison to avoid a timing oracle
  let ok = false;
  try {
    ok =
      expected.length === sig.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  if (!ok) return { ok: false, reason: "BAD_SIGNATURE" };

  const [tenantId, userId, expStr] = payload.split("|");
  const exp = Number(expStr);
  if (!tenantId || !userId || !Number.isFinite(exp)) {
    return { ok: false, reason: "MALFORMED" };
  }
  if (exp * 1000 < Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }
  return { ok: true, tenantId, userId, expiresAt: exp };
}
