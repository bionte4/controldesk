import { describe, expect, it, beforeAll } from "vitest";

// Provide a stable key so encoding/decoding is deterministic across
// runs. Must be at least 32 chars per `getEncryptionKey()`.
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY =
    "test-key-test-key-test-key-test-key-test-key-32chars";
});

// Dynamic import so the beforeAll env var lands before the module
// captures the key.
async function loadModule() {
  return await import("./link-token");
}

describe("telegram/link-token", () => {
  it("round-trips tenant + user with the encoded token", async () => {
    const { encodeLinkToken, decodeLinkToken } = await loadModule();
    const token = encodeLinkToken({
      tenantId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      ttlSeconds: 60,
    });
    const decoded = decodeLinkToken(token);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.tenantId).toBe("11111111-1111-1111-1111-111111111111");
      expect(decoded.userId).toBe("22222222-2222-2222-2222-222222222222");
    }
  });

  it("returns MALFORMED for a garbled token", async () => {
    const { decodeLinkToken } = await loadModule();
    const decoded = decodeLinkToken("not.a.real.token");
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.reason).toBe("MALFORMED");
    }
  });

  it("returns BAD_SIGNATURE when the payload is edited", async () => {
    const { encodeLinkToken, decodeLinkToken } = await loadModule();
    const token = encodeLinkToken({
      tenantId: "aaaaaaaa-1111-1111-1111-111111111111",
      userId: "bbbbbbbb-2222-2222-2222-222222222222",
      ttlSeconds: 60,
    });
    const [, sig] = token.split(".");
    // Replace the payload with a plausible-shaped one — signature
    // will no longer match.
    const forged = "Zm9vLmJhci5iYXo.__wrong_payload__" + "." + sig;
    const decoded = decodeLinkToken(forged);
    expect(decoded.ok).toBe(false);
  });

  it("returns EXPIRED once the TTL has elapsed", async () => {
    const { encodeLinkToken, decodeLinkToken } = await loadModule();
    // ttl=-1 forces expiry into the past — decoding will refuse.
    const token = encodeLinkToken({
      tenantId: "cccccccc-1111-1111-1111-111111111111",
      userId: "dddddddd-2222-2222-2222-222222222222",
      ttlSeconds: -1,
    });
    const decoded = decodeLinkToken(token);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.reason).toBe("EXPIRED");
    }
  });
});
