import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./crypto";

// Long-lived tests → use a lower work factor to stay under vitest timeouts.
// The default suite already runs with scrypt N=16384 which is ~150ms per hash
// on modern hardware, so we keep the count small.

describe("portal crypto — password hashing", () => {
  it("hashPassword produces a portable, self-describing string", async () => {
    const stored = await hashPassword("ControlDesk#2026");
    const parts = stored.split("$");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toMatch(/^N=\d+,r=\d+,p=\d+$/);
    // salt + key are base64url with no padding.
    expect(parts[2]).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(parts[3]).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("verifyPassword returns true for the correct password", async () => {
    const stored = await hashPassword("MyS3cret!");
    expect(await verifyPassword("MyS3cret!", stored)).toBe(true);
  });

  it("verifyPassword returns false for the wrong password", async () => {
    const stored = await hashPassword("MyS3cret!");
    expect(await verifyPassword("mys3cret!", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("hashPassword yields different outputs for the same password (unique salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    // But both still verify.
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("verifyPassword rejects a corrupt / malformed stored hash", async () => {
    expect(await verifyPassword("any", "")).toBe(false);
    expect(await verifyPassword("any", "bcrypt$foo")).toBe(false);
    expect(await verifyPassword("any", "scrypt$N=1,r=1,p=1$notb64!$xyz")).toBe(
      false,
    );
    expect(await verifyPassword("any", "scrypt$$$")).toBe(false);
  });

  it("hashPassword throws for an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});

describe("portal crypto — session tokens", () => {
  it("generateSessionToken returns a URL-safe 43-char base64url string", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  });

  it("generateSessionToken yields unique values", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i += 1) set.add(generateSessionToken());
    expect(set.size).toBe(100);
  });

  it("hashToken is deterministic and 64-char hex", () => {
    const token = generateSessionToken();
    const a = hashToken(token);
    const b = hashToken(token);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashToken diverges for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
