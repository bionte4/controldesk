export const SESSION_STARTED_COOKIE = "cd_session_started";
export const SESSION_ACTIVITY_COOKIE = "cd_session_activity";

function secret(): string {
  const value = process.env.SESSION_TIMEOUT_SECRET ?? process.env.CRON_SECRET;
  if (!value) throw new Error("SESSION_TIMEOUT_SECRET or CRON_SECRET is required");
  return value;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function signature(timestamp: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(String(timestamp)));
  return bytesToBase64Url(new Uint8Array(signed));
}

export async function createSessionTimestamp(now = Date.now()): Promise<string> {
  return `${now}.${await signature(now)}`;
}

export async function verifySessionTimestamp(raw: string | undefined): Promise<number | null> {
  if (!raw) return null;
  const [timestampRaw, supplied] = raw.split(".");
  const timestamp = Number(timestampRaw);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !supplied) return null;
  const expected = await signature(timestamp);
  if (expected.length !== supplied.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0 ? timestamp : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  priority: "high" as const,
  maxAge: 60 * 60 * 24 * 8,
};
