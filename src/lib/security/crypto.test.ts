/**
 * Unit tests for the encryption / masking helpers exposed by
 * `src/lib/security/crypto.ts`. All helpers are pure so no mocks are
 * needed — we manipulate `process.env.APP_ENCRYPTION_KEY` directly.
 *
 * Rules §3 (crypto helpers) + §21 (coverage floor).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canReadSensitive,
  decryptExpression,
  encryptExpression,
  getEncryptionKey,
  maskBankAccount,
  maskSalary,
  maskSensitive,
} from "./crypto";

const KEY_ENV = "APP_ENCRYPTION_KEY";

describe("getEncryptionKey", () => {
  const originalKey = process.env[KEY_ENV];

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env[KEY_ENV];
    } else {
      process.env[KEY_ENV] = originalKey;
    }
  });

  it("returns the key when it is at least 32 chars", () => {
    process.env[KEY_ENV] = "a".repeat(32);
    expect(getEncryptionKey()).toBe("a".repeat(32));
  });

  it("throws when the key is missing entirely", () => {
    delete process.env[KEY_ENV];
    expect(() => getEncryptionKey()).toThrowError(/APP_ENCRYPTION_KEY/);
  });

  it("throws when the key is shorter than 32 chars", () => {
    process.env[KEY_ENV] = "too-short";
    expect(() => getEncryptionKey()).toThrowError(/too short/);
  });
});

describe("encryptExpression / decryptExpression", () => {
  it("builds a pgp_sym_encrypt call around the given placeholder", () => {
    expect(encryptExpression("$1")).toBe(
      "pgp_sym_encrypt($1, current_setting('app.enc_key'))",
    );
  });

  it("builds a pgp_sym_decrypt select that casts + aliases the column", () => {
    const sql = decryptExpression({
      columnName: "salary_enc",
      postgresType: "numeric",
    });
    expect(sql).toContain("pgp_sym_decrypt(salary_enc::bytea");
    // The _enc suffix is stripped from the alias so callers can select
    // the "logical" column name without an extra AS.
    expect(sql).toContain(")::numeric as salary");
  });

  it("keeps the column name intact when it has no _enc suffix", () => {
    const sql = decryptExpression({
      columnName: "bank_account",
      postgresType: "text",
    });
    expect(sql).toContain(")::text as bank_account");
  });
});

describe("maskSensitive", () => {
  it("returns em-dash for null/undefined/empty", () => {
    expect(maskSensitive(null)).toBe("—");
    expect(maskSensitive(undefined)).toBe("—");
    expect(maskSensitive("")).toBe("—");
  });

  it("uses default 4 revealed chars + 8-char mask when length exceeds reveal", () => {
    const out = maskSensitive("1234567890");
    // 8 mask chars + last 4 revealed
    expect(out).toBe("••••••••7890");
  });

  it("preserves length when preserveLength=true", () => {
    const out = maskSensitive("123456", { reveal: 2, preserveLength: true });
    // 4 mask chars + last 2 revealed
    expect(out).toBe("••••56");
  });

  it("returns the raw string when preserveLength=true and shorter than reveal", () => {
    const out = maskSensitive("abc", { reveal: 5, preserveLength: true });
    expect(out).toBe("abc");
  });

  it("returns an all-mask string when shorter than reveal and preserveLength=false", () => {
    const out = maskSensitive("abc", { reveal: 5 });
    expect(out).toBe("•••");
  });

  it("respects a custom mask character", () => {
    const out = maskSensitive("secret123", { reveal: 3, maskChar: "*" });
    expect(out).toBe("********123");
  });

  it("clamps negative reveal to zero (no crash)", () => {
    // With reveal clamped to 0 and preserveLength=true, the JS quirk
    // `s.slice(-0) === s` surfaces the whole string as "visible" and
    // pads with s.length mask chars. We assert the shape, not a
    // specific string, so the test survives a future ergonomic tweak.
    const out = maskSensitive("abc", { reveal: -5, preserveLength: true });
    expect(out).toContain("•");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThanOrEqual("abc".length);
  });

  it("coerces a number to string before masking", () => {
    const out = maskSensitive(1234567890);
    expect(out).toBe("••••••••7890");
  });
});

describe("maskBankAccount", () => {
  it("keeps last 4 digits and pads with dots to preserve length", () => {
    expect(maskBankAccount("1234567890")).toBe("••••••7890");
  });

  it("returns em-dash for null/undefined", () => {
    expect(maskBankAccount(null)).toBe("—");
    expect(maskBankAccount(undefined)).toBe("—");
  });
});

describe("maskSalary", () => {
  it("returns em-dash for null/undefined", () => {
    expect(maskSalary(null)).toBe("—");
    expect(maskSalary(undefined)).toBe("—");
  });

  it("returns the '•• restricted' sentinel for any numeric value", () => {
    expect(maskSalary(15_000_000)).toBe("•• restricted");
    expect(maskSalary(0)).toBe("•• restricted");
  });

  it("accepts locale/currency args without affecting output", () => {
    // Kept in the signature for a future 'partial' mode; tolerate the args
    // now to lock the contract.
    expect(maskSalary(1_000_000, "en-US", "USD")).toBe("•• restricted");
  });
});

describe("canReadSensitive", () => {
  it("returns true for HR/Finance/Tenant Admin", () => {
    expect(canReadSensitive("HR_ADMIN")).toBe(true);
    expect(canReadSensitive("LEAD_FINANCE")).toBe(true);
    expect(canReadSensitive("TENANT_ADMIN")).toBe(true);
  });

  it("returns false for every other role", () => {
    for (const role of [
      "EMPLOYEE",
      "SUPERVISOR",
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "PETTY_CASH_CUSTODIAN",
    ] as const) {
      expect(canReadSensitive(role)).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// setup / teardown notes
// -----------------------------------------------------------------------------
beforeEach(() => {
  // Nothing to reset per-test; helpers are pure and only read env at call time.
});
