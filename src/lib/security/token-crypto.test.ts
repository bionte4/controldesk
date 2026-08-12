import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptToken, encryptToken } from "./token-crypto";

// A 32+ char master key is required — see getEncryptionKey().
const MASTER = "test-master-key-32-chars-min-length-abcdef";

describe("token-crypto (AES-256-GCM)", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = MASTER;
  });

  afterEach(() => {
    process.env.APP_ENCRYPTION_KEY = originalKey;
  });

  it("roundtrips a plaintext string", () => {
    const secret = "1//abc.refresh_token.google_oauth_XYZ";
    const enc = encryptToken(secret);
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain(secret);
    expect(decryptToken(enc)).toBe(secret);
  });

  it("emits a distinct ciphertext every call (fresh IV) for the same plaintext", () => {
    // Guards against a nonce-reuse regression, which would be catastrophic
    // for GCM authentication guarantees.
    const secret = "same-plaintext";
    const a = encryptToken(secret);
    const b = encryptToken(secret);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(secret);
    expect(decryptToken(b)).toBe(secret);
  });

  it("throws on tampered ciphertext (GCM authentication)", () => {
    const enc = encryptToken("do-not-tamper");
    // Flip a character in the ciphertext portion.
    const parts = enc.split(".");
    parts[2] = parts[2]!.startsWith("A") ? "B" + parts[2]!.slice(1) : "A" + parts[2]!.slice(1);
    const tampered = parts.join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws on unknown version prefix", () => {
    expect(() => decryptToken("v9.abc.def.ghi")).toThrow(/unknown ciphertext version/);
    expect(() => decryptToken("garbage")).toThrow(/unknown ciphertext version/);
  });

  it("throws on empty plaintext (defensive)", () => {
    expect(() => encryptToken("")).toThrow(/non-empty string/);
  });

  it("decrypt fails when the master key has rotated to a different value", () => {
    const enc = encryptToken("rotate-me");
    process.env.APP_ENCRYPTION_KEY =
      "different-master-key-32-chars-abcdefghij";
    expect(() => decryptToken(enc)).toThrow();
  });
});
