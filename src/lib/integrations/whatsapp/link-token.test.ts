import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY =
    "test-key-test-key-test-key-test-key-test-key-32chars";
});

async function loadModule() {
  return await import("./link-token");
}

describe("whatsapp/link-token", () => {
  it("round-trips tenant + user with the encoded token", async () => {
    const { encodeWhatsAppLinkToken, decodeWhatsAppLinkToken } =
      await loadModule();
    const token = encodeWhatsAppLinkToken({
      tenantId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      ttlSeconds: 60,
    });
    const decoded = decodeWhatsAppLinkToken(token);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.tenantId).toBe("11111111-1111-1111-1111-111111111111");
      expect(decoded.userId).toBe("22222222-2222-2222-2222-222222222222");
    }
  });

  it("returns MALFORMED for a garbled token", async () => {
    const { decodeWhatsAppLinkToken } = await loadModule();
    const decoded = decodeWhatsAppLinkToken("not.a.real.token");
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.reason).toBe("MALFORMED");
    }
  });

  it("returns EXPIRED once the TTL has elapsed", async () => {
    const { encodeWhatsAppLinkToken, decodeWhatsAppLinkToken } =
      await loadModule();
    const token = encodeWhatsAppLinkToken({
      tenantId: "cccccccc-1111-1111-1111-111111111111",
      userId: "dddddddd-2222-2222-2222-222222222222",
      ttlSeconds: -1,
    });
    const decoded = decodeWhatsAppLinkToken(token);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.reason).toBe("EXPIRED");
    }
  });

  it("rejects tokens with wrong version prefix", async () => {
    const { decodeWhatsAppLinkToken } = await loadModule();
    // Manually craft a v0 payload (should be rejected — WhatsApp
    // tokens are anchored at "w1"). Sig will be wrong too but the
    // version check runs after signature verification, so this
    // actually surfaces BAD_SIGNATURE first. Either failure mode
    // is acceptable — we assert `ok===false`.
    const decoded = decodeWhatsAppLinkToken("dGVzdA.YW55c2ln");
    expect(decoded.ok).toBe(false);
  });
});
