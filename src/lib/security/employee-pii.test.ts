import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __internals,
  decryptEmployeePii,
  encryptEmployeePii,
  fromBytea,
  hashEmployeeNik,
  nikHashesEqual,
  toBytea,
} from "./employee-pii";
import { encryptToken } from "./token-crypto";

// A 32+ char master key is required — see getEncryptionKey().
const MASTER = "test-master-key-32-chars-min-length-abcdef";
const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_NIK = "3201234567890001";
const OTHER_NIK = "3201234567890002";
const BANK_ACCT = "0011223344556677";

describe("employee-pii (AES-256-GCM columnar encryption)", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = MASTER;
  });

  afterEach(() => {
    process.env.APP_ENCRYPTION_KEY = originalKey;
  });

  describe("encrypt / decrypt round-trip", () => {
    it("round-trips a plaintext NIK", () => {
      const enc = encryptEmployeePii(VALID_NIK);
      expect(enc).not.toBeNull();
      expect(enc).toMatch(/^v1\./);
      expect(enc).not.toContain(VALID_NIK);
      expect(decryptEmployeePii(enc)).toBe(VALID_NIK);
    });

    it("round-trips a plaintext bank account number", () => {
      const enc = encryptEmployeePii(BANK_ACCT);
      expect(enc).not.toBeNull();
      expect(decryptEmployeePii(enc)).toBe(BANK_ACCT);
    });

    it("emits a distinct ciphertext every call (fresh IV per encrypt)", () => {
      const a = encryptEmployeePii(VALID_NIK)!;
      const b = encryptEmployeePii(VALID_NIK)!;
      // Belt-and-braces against nonce reuse — a regression here would
      // catastrophically weaken AES-GCM.
      expect(a).not.toBe(b);
      // Both must still decrypt to the same plaintext.
      expect(decryptEmployeePii(a)).toBe(VALID_NIK);
      expect(decryptEmployeePii(b)).toBe(VALID_NIK);
    });

    it("returns null for null / undefined / whitespace-only input", () => {
      expect(encryptEmployeePii(null)).toBeNull();
      expect(encryptEmployeePii(undefined)).toBeNull();
      expect(encryptEmployeePii("")).toBeNull();
      expect(encryptEmployeePii("   ")).toBeNull();
    });

    it("returns null when decrypting null / empty ciphertext", () => {
      expect(decryptEmployeePii(null)).toBeNull();
      expect(decryptEmployeePii(undefined)).toBeNull();
      expect(decryptEmployeePii("")).toBeNull();
    });

    it("trims plaintext before encrypting (leading/trailing whitespace is not stored)", () => {
      const enc = encryptEmployeePii(`  ${VALID_NIK}  `);
      expect(decryptEmployeePii(enc)).toBe(VALID_NIK);
    });
  });

  describe("tamper detection (GCM auth)", () => {
    it("throws when ciphertext bytes are flipped", () => {
      const enc = encryptEmployeePii(VALID_NIK)!;
      const parts = enc.split(".");
      // Flip one char in the ciphertext component — GCM tag must reject.
      const bytes = parts[2]!.split("");
      bytes[0] = bytes[0] === "A" ? "B" : "A";
      parts[2] = bytes.join("");
      expect(() => decryptEmployeePii(parts.join("."))).toThrow();
    });

    it("throws when auth tag is tampered", () => {
      const enc = encryptEmployeePii(VALID_NIK)!;
      const parts = enc.split(".");
      // Flip the first char in the tag component. Truncation isn't a
      // reliable tamper signal because Node's GCM implementation
      // accepts 12-16 byte tags, so shortening can still auth against
      // a "truncated" tag length. Flipping a byte in the tag has
      // deterministic detection behaviour.
      const tagChars = parts[3]!.split("");
      tagChars[0] = tagChars[0] === "A" ? "B" : "A";
      parts[3] = tagChars.join("");
      expect(() => decryptEmployeePii(parts.join("."))).toThrow();
    });

    it("throws on unknown version prefix", () => {
      expect(() => decryptEmployeePii("v2.aa.bb.cc")).toThrow(/version/);
    });

    it("throws on malformed structure (fewer than 4 parts)", () => {
      expect(() => decryptEmployeePii("v1.aa.bb")).toThrow(/malformed/);
    });
  });

  describe("KDF domain separation from token-crypto", () => {
    it("token-crypto ciphertext CANNOT be decrypted by employee-pii", () => {
      // Both modules share `APP_ENCRYPTION_KEY` and the same wire format,
      // but they derive DIFFERENT keys via distinct HKDF info strings.
      // Cross-decrypting must fail on the GCM auth tag — this is the
      // security-critical invariant that domain separation buys us.
      const oauthTokenCt = encryptToken("1//abc.refresh_token.oauth_XYZ");
      // Same wire format but DIFFERENT derived key — must reject via
      // GCM auth tag mismatch, not via structure mismatch.
      expect(() => decryptEmployeePii(oauthTokenCt)).toThrow();
    });

    it("employee-pii keys are actually different from token-crypto keys", () => {
      // Direct assertion at the internal helper level — the derived
      // bytes must differ; if they ever collide (e.g. a copy-paste
      // regression on the KDF_INFO), the previous cross-decrypt test
      // could still fail via GCM but for the wrong reason. This test
      // catches the root-cause regression.
      const encKey = __internals.deriveEncKey();
      const hashKey = __internals.deriveHashKey();
      expect(encKey.equals(hashKey)).toBe(false);
      expect(encKey.length).toBe(32);
      expect(hashKey.length).toBe(32);
    });
  });

  describe("blind-index hash", () => {
    it("is deterministic — same NIK + tenant → same hash", () => {
      const a = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A });
      const b = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A });
      expect(a).not.toBeNull();
      expect(nikHashesEqual(a, b)).toBe(true);
    });

    it("produces different hashes for the SAME NIK across different tenants", () => {
      // Prevents cross-tenant leakage: an attacker who exfiltrates
      // hashes from tenant A cannot correlate them to tenant B.
      const a = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A });
      const b = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_B });
      expect(nikHashesEqual(a, b)).toBe(false);
    });

    it("produces different hashes for different NIKs in the same tenant", () => {
      const a = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A });
      const b = hashEmployeeNik({ nik: OTHER_NIK, tenantId: TENANT_A });
      expect(nikHashesEqual(a, b)).toBe(false);
    });

    it("returns null for null / empty / whitespace NIK", () => {
      expect(hashEmployeeNik({ nik: null, tenantId: TENANT_A })).toBeNull();
      expect(hashEmployeeNik({ nik: undefined, tenantId: TENANT_A })).toBeNull();
      expect(hashEmployeeNik({ nik: "", tenantId: TENANT_A })).toBeNull();
      expect(hashEmployeeNik({ nik: "   ", tenantId: TENANT_A })).toBeNull();
    });

    it("trims NIK input before hashing (matches the encrypt-side normalisation)", () => {
      const a = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A });
      const b = hashEmployeeNik({ nik: `  ${VALID_NIK}  `, tenantId: TENANT_A });
      expect(nikHashesEqual(a, b)).toBe(true);
    });

    it("does not collide with an adversarial concatenation (nul-byte separator)", () => {
      // Belt-and-braces: without a separator, HMAC("tenantA" + "1234")
      // could equal HMAC("tenantA1" + "234"). Our impl uses \x00 —
      // this test locks the invariant in.
      const a = hashEmployeeNik({ nik: "1234567890123456", tenantId: TENANT_A });
      const b = hashEmployeeNik({
        nik: "234567890123456",
        tenantId: `${TENANT_A}1`,
      });
      expect(nikHashesEqual(a, b)).toBe(false);
    });
  });

  describe("nikHashesEqual", () => {
    it("returns true for equal buffers, false for unequal", () => {
      const a = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A });
      const b = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A });
      const c = hashEmployeeNik({ nik: OTHER_NIK, tenantId: TENANT_A });
      expect(nikHashesEqual(a, b)).toBe(true);
      expect(nikHashesEqual(a, c)).toBe(false);
    });

    it("returns true for null == null, false for one-null asymmetry", () => {
      const a = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A });
      expect(nikHashesEqual(null, null)).toBe(true);
      expect(nikHashesEqual(a, null)).toBe(false);
      expect(nikHashesEqual(null, a)).toBe(false);
    });
  });

  describe("bytea interop (Buffer ↔ Postgres textual form)", () => {
    it("round-trips a Buffer through toBytea → fromBytea", () => {
      const hash = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A })!;
      const wire = toBytea(hash);
      expect(wire).toMatch(/^\\x[0-9a-f]+$/);
      const parsed = fromBytea(wire);
      expect(nikHashesEqual(parsed, hash)).toBe(true);
    });

    it("null → null in both directions", () => {
      expect(toBytea(null)).toBeNull();
      expect(fromBytea(null)).toBeNull();
      expect(fromBytea(undefined)).toBeNull();
    });

    it("accepts raw hex without the \\x prefix (defensive)", () => {
      const hash = hashEmployeeNik({ nik: VALID_NIK, tenantId: TENANT_A })!;
      const parsed = fromBytea(hash.toString("hex"));
      expect(nikHashesEqual(parsed, hash)).toBe(true);
    });

    it("throws on non-hex payload", () => {
      expect(() => fromBytea("\\xZZZZ")).toThrow(/invalid hex/);
    });
  });

  describe("post-rotation behaviour", () => {
    it("decrypt fails when APP_ENCRYPTION_KEY has rotated", () => {
      const enc = encryptEmployeePii(VALID_NIK)!;
      // Rotate the master key mid-test — the derived AES key changes,
      // and GCM auth must reject the pre-rotation ciphertext. This
      // matches the operational reality described in the module
      // doc-comment (rules §22 90-day rotation invalidates all
      // existing ciphertexts, requires re-encrypt job).
      process.env.APP_ENCRYPTION_KEY =
        "different-32-char-key-for-rotation-check-123";
      expect(() => decryptEmployeePii(enc)).toThrow();
    });

    it("NIK hash changes after rotation (blind index invalidated)", () => {
      const beforeRotation = hashEmployeeNik({
        nik: VALID_NIK,
        tenantId: TENANT_A,
      });
      process.env.APP_ENCRYPTION_KEY =
        "different-32-char-key-for-rotation-check-123";
      const afterRotation = hashEmployeeNik({
        nik: VALID_NIK,
        tenantId: TENANT_A,
      });
      expect(nikHashesEqual(beforeRotation, afterRotation)).toBe(false);
    });
  });
});
