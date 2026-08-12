import { describe, expect, it } from "vitest";

import {
  bucketSalary,
  redactBankAccount,
  redactEmail,
  redactEmployee,
  redactName,
  redactPhone,
  scrubPrompt,
} from "./redact";

describe("redactName", () => {
  it("is deterministic for the same input", () => {
    const a = redactName("Putri PM");
    const b = redactName("putri pm  ");
    expect(a).toBe(b);
    expect(a).toMatch(/^emp_[0-9a-f]{8}$/);
  });

  it("returns emp_anon for empty/undefined input", () => {
    expect(redactName(null)).toBe("emp_anon");
    expect(redactName(undefined)).toBe("emp_anon");
    expect(redactName("")).toBe("emp_anon");
  });

  it("differs for different names", () => {
    expect(redactName("Alice")).not.toBe(redactName("Bob"));
  });
});

describe("redactEmail", () => {
  it("hashes emails deterministically", () => {
    expect(redactEmail("A@Foo.com")).toBe(redactEmail("a@foo.com"));
    expect(redactEmail("a@foo.com")).toMatch(/^user_[0-9a-f]{8}@redacted$/);
  });
});

describe("redactPhone", () => {
  it("shows only last 4 digits", () => {
    expect(redactPhone("+62 811 2345 6789")).toBe("+62-XXX-XXXX-6789");
  });

  it("pads short numbers to 4 X's", () => {
    expect(redactPhone("12")).toBe("+62-XXX-XXXX-XX12");
  });

  it("returns placeholder for empty input", () => {
    expect(redactPhone(null)).toBe("+62-XXX-XXXX-XXXX");
  });
});

describe("redactBankAccount", () => {
  it("shows only last 4 digits", () => {
    expect(redactBankAccount("1234567890123456")).toBe("bank_****3456");
    expect(redactBankAccount(null)).toBe("bank_****XXXX");
  });
});

describe("bucketSalary", () => {
  it("assigns each salary to the correct bucket", () => {
    expect(bucketSalary(0)).toBe("≤5jt");
    expect(bucketSalary(5_000_000)).toBe("≤5jt");
    expect(bucketSalary(7_000_000)).toBe("5–10jt");
    expect(bucketSalary(15_000_000)).toBe("10–20jt");
    expect(bucketSalary(35_000_000)).toBe("20–50jt");
    expect(bucketSalary(100_000_000)).toBe(">50jt");
  });

  it("handles nullish / invalid inputs", () => {
    expect(bucketSalary(null)).toBe("unknown");
    expect(bucketSalary(undefined)).toBe("unknown");
    expect(bucketSalary(-1)).toBe("unknown");
    expect(bucketSalary(NaN)).toBe("unknown");
  });
});

describe("redactEmployee", () => {
  it("produces a fully redacted record", () => {
    const r = redactEmployee({
      id: "11111111-1111-1111-1111-111111111111",
      role: "PROJECT_MANAGER",
      full_name: "Putri PM",
      email: "putri@demo.controldesk.app",
      phone: "+62 811 234 5678",
      monthly_salary: 12_000_000,
      bank_account_number: "1234567890",
    });
    expect(r.name).toMatch(/^emp_/);
    expect(r.email).toMatch(/^user_/);
    expect(r.phone).toContain("5678");
    expect(r.bank_account).toBe("bank_****7890");
    expect(r.salary_bucket).toBe("10–20jt");
    expect(r.role).toBe("PROJECT_MANAGER");
    expect(r.id_ref).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("scrubPrompt", () => {
  it("redacts KTP-shaped numbers", () => {
    expect(scrubPrompt("KTP: 3175012312345678 done")).toContain("[KTP_REDACTED]");
  });

  it("redacts NPWP-shaped numbers", () => {
    expect(scrubPrompt("NPWP 12.345.678.9-012.345 tax")).toContain(
      "[NPWP_REDACTED]",
    );
  });

  it("redacts bank-like account numbers", () => {
    // 14-digit non-phone-shaped account: doesn't start with 62/08, sits in
    // the 10-15 window used by the account regex.
    expect(scrubPrompt("acct 71234567890123 sent")).toContain(
      "[ACC_REDACTED]",
    );
  });

  it("redacts Indonesian phone numbers", () => {
    expect(scrubPrompt("call 081234567890 asap")).toContain("[PHONE_REDACTED]");
    expect(scrubPrompt("dial +6281234567890 now")).toContain("[PHONE_REDACTED]");
  });

  it("redacts leftover emails", () => {
    expect(scrubPrompt("email me at fajar@demo.controldesk.app")).toContain(
      "[EMAIL_REDACTED]",
    );
  });
});
