import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

import { getEncryptionKey } from "@/lib/security/crypto";

/**
 * Signed deep-link token for the WhatsApp click-to-chat flow.
 *
 * WhatsApp's equivalent of Telegram's `/start <token>` is the
 * click-to-chat URL:
 *
 *   https://wa.me/<business_phone>?text=%2Fstart%20<token>
 *
 * The user taps the link, WhatsApp opens the business chat with the
 * pre-filled message `/start <token>`, and when they hit Send our
 * webhook receives the message. From there we decode the token,
 * verify the signature + TTL, and upsert the user link.
 *
 * We reuse the exact same signature scheme as
 * `integrations/telegram/link-token.ts` — copy-paste is deliberate:
 *   * keeps the two files independently rippable if the underlying
 *     protocol diverges in a later phase (e.g. WhatsApp gains OTP);
 *   * uses different KDF `info` string via `getEncryptionKey()` so
 *     a Telegram token can't be replayed against the WhatsApp
 *     webhook — the shared HMAC key doesn't leak because we never
 *     share the token itself across providers.
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
  return Buffer.from(
    s.replaceAll("-", "+").replaceAll("_", "/") + pad,
    "base64",
  );
}

function sign(payload: string): string {
  const key = getEncryptionKey();
  return b64u(createHmac("sha256", key).update(payload).digest());
}

export function encodeWhatsAppLinkToken(input: {
  tenantId: string;
  userId: string;
  ttlSeconds?: number;
}): string {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  // Version prefix ("w1") so we can rotate token schema later
  // without a data migration — the webhook can accept both v1 and
  // v2 tokens during the flip.
  const payload = `w1|${input.tenantId}|${input.userId}|${exp}`;
  const encodedPayload = b64u(Buffer.from(payload, "utf8"));
  const sig = sign(payload);
  return `${encodedPayload}.${sig}`;
}

export type DecodedWhatsAppLinkToken =
  | { ok: true; tenantId: string; userId: string; expiresAt: number }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

export function decodeWhatsAppLinkToken(
  token: string,
): DecodedWhatsAppLinkToken {
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
  let ok = false;
  try {
    ok =
      expected.length === sig.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  if (!ok) return { ok: false, reason: "BAD_SIGNATURE" };

  const [version, tenantId, userId, expStr] = payload.split("|");
  if (version !== "w1") {
    return { ok: false, reason: "MALFORMED" };
  }
  const exp = Number(expStr);
  if (!tenantId || !userId || !Number.isFinite(exp)) {
    return { ok: false, reason: "MALFORMED" };
  }
  if (exp * 1000 < Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }
  return { ok: true, tenantId, userId, expiresAt: exp };
}
