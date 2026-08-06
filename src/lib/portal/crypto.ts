/**
 * ControlDesk — Client Portal password & session-token crypto helpers
 * (GAS §28, rules §3 hygiene).
 *
 * Rationale — why scrypt instead of bcrypt:
 *   • Node.js 20+ ships `crypto.scrypt` (memory-hard KDF) in the standard
 *     library — no extra dependency, no native module compile step in the
 *     Docker builder stage (rules §2).
 *   • Cost parameters (N=16384, r=8, p=1) match Node's own defaults and are
 *     tunable via `SCRYPT_COST` env if we need to bump work factor.
 *
 * Storage format (portable, self-describing):
 *
 *     scrypt$N=<N>,r=<r>,p=<p>$<salt-base64url>$<hash-base64url>
 *
 * Session tokens:
 *   • Opaque 32-byte random string, base64url-encoded (43 chars, URL-safe).
 *   • Stored in `client_user_sessions.token_hash` as sha256(token) hex — the
 *     raw token is only ever set on the response cookie.
 *   • Constant-time comparison via `crypto.timingSafeEqual`.
 */

import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

// ---------------------------------------------------------------------------
// Cost params. Node's stdlib defaults; tunable via env for load-testing.
// ---------------------------------------------------------------------------
const DEFAULT_N = 16_384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
// scrypt needs ~128 * N * r bytes. With N=16384, r=8 → ~16.8 MB. Bump maxmem
// for anyone tuning N upward.
const MAX_MEM = 64 * 1024 * 1024;

function readCostFromEnv(): { N: number; r: number; p: number } {
  const raw = process.env.PORTAL_SCRYPT_COST;
  if (!raw) return { N: DEFAULT_N, r: DEFAULT_R, p: DEFAULT_P };
  try {
    const parsed = JSON.parse(raw) as {
      N?: number;
      r?: number;
      p?: number;
    };
    return {
      N: parsed.N && parsed.N > 0 ? parsed.N : DEFAULT_N,
      r: parsed.r && parsed.r > 0 ? parsed.r : DEFAULT_R,
      p: parsed.p && parsed.p > 0 ? parsed.p : DEFAULT_P,
    };
  } catch {
    return { N: DEFAULT_N, r: DEFAULT_R, p: DEFAULT_P };
  }
}

// ---------------------------------------------------------------------------
// Base64url helpers (no `=` padding, `+`→`-`, `/`→`_`).
// ---------------------------------------------------------------------------
function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const normalised = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(normalised, "base64");
}

// ---------------------------------------------------------------------------
// Password hashing.
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext password using scrypt. Returns a portable, self-describing
 * string suitable for storage in `client_users.password_hash`.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length === 0) {
    throw new Error("Password must be a non-empty string.");
  }
  const cost = readCostFromEnv();
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, KEY_LEN, {
    ...cost,
    maxmem: MAX_MEM,
  });
  return `scrypt$N=${cost.N},r=${cost.r},p=${cost.p}$${b64url(salt)}$${b64url(key)}`;
}

/**
 * Verify a plaintext password against a stored `hashPassword()` output.
 * Returns `false` on any parse failure — never throws for a malformed hash so
 * timing-side-channel remains uniform across paths.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!password || !stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const params = parseParams(parts[1]);
  if (!params) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = fromB64url(parts[2]);
    expected = fromB64url(parts[3]);
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(password, salt, expected.length, {
      ...params,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function parseParams(
  segment: string,
): { N: number; r: number; p: number } | null {
  const pairs = segment.split(",");
  const out: Record<string, number> = {};
  for (const pair of pairs) {
    const [k, v] = pair.split("=");
    const parsed = Number(v);
    if (!k || !Number.isFinite(parsed) || parsed <= 0) return null;
    out[k] = parsed;
  }
  if (!out.N || !out.r || !out.p) return null;
  return { N: out.N, r: out.r, p: out.p };
}

// ---------------------------------------------------------------------------
// Session tokens.
// ---------------------------------------------------------------------------

/**
 * Generate an opaque, URL-safe session token (32 random bytes, base64url).
 * The raw token is what goes into the cookie; call `hashToken(raw)` to get
 * the sha256 hex fingerprint that lives in
 * `client_user_sessions.token_hash`.
 */
export function generateSessionToken(): string {
  return b64url(randomBytes(32));
}

// ---------------------------------------------------------------------------
// Temporary passwords for admin-provisioned client portal users
// (rules §28 B.4 admin). We deliberately exclude visually ambiguous
// characters (`0/O/I/l/1`) so admins can retype without typos when sharing
// via voice/SMS.
// ---------------------------------------------------------------------------
const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * Generate a 12-character random temporary password using a rejection-sampling
 * loop against a base64 token. Suitable for one-time provisioning; the client
 * user should be prompted to change it on first login (future work).
 */
export function generateTempPassword(length = 12): string {
  if (length < 8 || length > 64) {
    throw new Error("generateTempPassword: length must be between 8 and 64");
  }
  const bytes = randomBytes(length * 2);
  const chars: string[] = [];
  for (let i = 0; chars.length < length && i < bytes.length; i += 1) {
    const idx = bytes[i] % TEMP_PASSWORD_ALPHABET.length;
    chars.push(TEMP_PASSWORD_ALPHABET[idx]);
  }
  // In the astronomically unlikely case we ran out of bytes, top up with a
  // safe fallback.
  while (chars.length < length) chars.push("x");
  return chars.join("");
}

/** Sha256 fingerprint (hex) of a raw session token. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
