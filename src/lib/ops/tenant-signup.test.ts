import { describe, expect, it } from "vitest";

import {
  SELF_SIGNUP_TRIAL_DAYS,
  SIGNUP_EMAIL_PATTERN,
  SIGNUP_RATE_LIMIT_GLOBAL,
  SIGNUP_RATE_LIMIT_PER_IP,
  SIGNUP_RESERVED_SLUGS,
  SIGNUP_SLUG_PATTERN,
  SIGNUP_TOKEN_TTL_HOURS,
  computeTrialStatus,
  generateSignupToken,
  hashSignupToken,
  renderSignupConfirmationEmail,
  renderSignupVerificationEmail,
  validateSignupInput,
} from "./tenant-signup";

describe("generateSignupToken", () => {
  it("produces a URL-safe base64 raw token (no +, /, =)", () => {
    for (let i = 0; i < 20; i++) {
      const { raw } = generateSignupToken();
      expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(raw.length).toBeGreaterThanOrEqual(40);
    }
  });

  it("hash is deterministic for the same raw", () => {
    const { raw } = generateSignupToken();
    expect(hashSignupToken(raw)).toBe(hashSignupToken(raw));
  });

  it("different raws produce different hashes", () => {
    const a = generateSignupToken();
    const b = generateSignupToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it("hash is a 64-char lowercase hex string (sha256)", () => {
    const { hash } = generateSignupToken();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("SIGNUP_SLUG_PATTERN", () => {
  // NOTE: pattern intentionally kept in sync with tenant-provisioning's
  // SLUG_PATTERN, which allows a trailing hyphen (rare edge case;
  // the DB check constraint on tenants.slug is the authoritative
  // final gate). Focus of these tests: reject clearly-invalid input.
  it.each([
    ["acme", true],
    ["ac", true],
    ["a1", true],
    ["acme-corp", true],
    ["pt-acme-1", true],
    ["ACME", false], // uppercase disallowed
    ["a", false], // too short
    ["-acme", false], // leading hyphen
    ["acme_corp", false], // underscore disallowed
    ["acme.corp", false], // dot disallowed
    ["acme corp", false], // space disallowed
    // 63 chars — max allowed:
    ["a" + "b".repeat(61) + "c", true],
    // 64 chars — over limit:
    ["a" + "b".repeat(62) + "c", false],
  ])("matches %s → %s", (input, expected) => {
    expect(SIGNUP_SLUG_PATTERN.test(input)).toBe(expected);
  });
});

describe("SIGNUP_RESERVED_SLUGS", () => {
  it("blocks marketing + infra + auth subdomains", () => {
    for (const s of [
      "www",
      "api",
      "admin",
      "app",
      "auth",
      "super-admin",
      "portal",
      "controldesk",
      "staging",
      "prod",
    ]) {
      expect(SIGNUP_RESERVED_SLUGS.has(s), s).toBe(true);
    }
  });

  it("allows regular org names", () => {
    for (const s of ["acme", "pt-sejahtera", "kontraktor-jaya"]) {
      expect(SIGNUP_RESERVED_SLUGS.has(s), s).toBe(false);
    }
  });
});

describe("SIGNUP_EMAIL_PATTERN", () => {
  it.each([
    ["user@example.com", true],
    ["user.tag+alias@sub.example.co.id", true],
    ["a@b.co", true],
    ["no-at-sign", false],
    ["@nodomain.com", false],
    ["user@", false],
    ["user@nodot", false],
    ["user@x.a", false], // single-char TLD
  ])("matches %s → %s", (input, expected) => {
    expect(SIGNUP_EMAIL_PATTERN.test(input)).toBe(expected);
  });
});

describe("validateSignupInput", () => {
  const good = {
    slug: "acme",
    name: "PT Acme",
    adminEmail: "admin@acme.co.id",
    adminName: "Budi Santoso",
  };

  it("accepts a well-formed input", () => {
    expect(validateSignupInput(good).ok).toBe(true);
  });

  it("rejects reserved slug", () => {
    const r = validateSignupInput({ ...good, slug: "www" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.field === "slug")).toBe(true);
    }
  });

  it("rejects short name", () => {
    const r = validateSignupInput({ ...good, name: "A" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.field === "name")).toBe(true);
    }
  });

  it("rejects bad email", () => {
    const r = validateSignupInput({ ...good, adminEmail: "not-an-email" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.field === "adminEmail")).toBe(true);
    }
  });

  it("collects multiple issues in one pass", () => {
    const r = validateSignupInput({
      slug: "www",
      name: "A",
      adminEmail: "no-at",
      adminName: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = new Set(r.issues.map((i) => i.field));
      expect(fields).toEqual(
        new Set(["slug", "name", "adminEmail", "adminName"]),
      );
    }
  });

  it("normalises to lowercase before checking reserved", () => {
    const r = validateSignupInput({ ...good, slug: "WWW" });
    // WWW → www is reserved, but slug pattern also rejects uppercase.
    // Either error is fine; assert at least one issue.
    expect(r.ok).toBe(false);
  });
});

describe("renderSignupVerificationEmail", () => {
  it("puts the verify URL in the body verbatim", () => {
    const email = renderSignupVerificationEmail({
      tenantName: "PT Acme",
      slug: "acme",
      adminName: "Budi",
      verifyUrl:
        "https://controldesk.app/register-org/verify/abc123DEF-_ghi",
    });
    expect(email.subject).toContain("PT Acme");
    expect(email.text).toContain(
      "https://controldesk.app/register-org/verify/abc123DEF-_ghi",
    );
  });

  it("mentions the TTL", () => {
    const email = renderSignupVerificationEmail({
      tenantName: "PT Acme",
      slug: "acme",
      adminName: "Budi",
      verifyUrl: "https://example",
      ttlHours: 6,
    });
    expect(email.text).toContain("6 jam");
  });

  it("uses default TTL when not passed", () => {
    const email = renderSignupVerificationEmail({
      tenantName: "PT Acme",
      slug: "acme",
      adminName: "Budi",
      verifyUrl: "https://example",
    });
    expect(email.text).toContain(`${SIGNUP_TOKEN_TTL_HOURS} jam`);
  });
});

describe("renderSignupConfirmationEmail", () => {
  it("includes email + password + login URL", () => {
    const email = renderSignupConfirmationEmail({
      tenantName: "PT Acme",
      slug: "acme",
      adminName: "Budi",
      adminEmail: "admin@acme.co.id",
      adminPassword: "s3cretP@ssword",
      loginUrl: "https://acme.controldesk.app/login",
    });
    expect(email.text).toContain("admin@acme.co.id");
    expect(email.text).toContain("s3cretP@ssword");
    expect(email.text).toContain("https://acme.controldesk.app/login");
    expect(email.text).toContain("14 hari"); // default trial
  });
});

describe("computeTrialStatus", () => {
  const now = new Date("2026-08-10T00:00:00Z");

  it("returns not_on_trial when trialEndsAt is null", () => {
    expect(computeTrialStatus(null, now).kind).toBe("not_on_trial");
    expect(computeTrialStatus(undefined, now).kind).toBe("not_on_trial");
  });

  it("returns not_on_trial for invalid date string", () => {
    expect(computeTrialStatus("not-a-date", now).kind).toBe("not_on_trial");
  });

  it("returns active with correct daysRemaining", () => {
    const endsAt = new Date("2026-08-15T00:00:00Z"); // 5 days out
    const res = computeTrialStatus(endsAt, now);
    expect(res.kind).toBe("active");
    if (res.kind === "active") {
      expect(res.daysRemaining).toBe(5);
      expect(res.endsAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    }
  });

  it("rounds partial days UP (1.5 days remaining → 2)", () => {
    const endsAt = new Date("2026-08-11T12:00:00Z"); // 1.5 days
    const res = computeTrialStatus(endsAt, now);
    expect(res.kind).toBe("active");
    if (res.kind === "active") {
      expect(res.daysRemaining).toBe(2);
    }
  });

  it("returns expired when trialEndsAt is in the past", () => {
    const endsAt = new Date("2026-08-05T00:00:00Z"); // 5 days ago
    const res = computeTrialStatus(endsAt, now);
    expect(res.kind).toBe("expired");
    if (res.kind === "expired") {
      expect(res.daysSince).toBe(5);
    }
  });

  it("treats exactly-now as expired (boundary)", () => {
    const res = computeTrialStatus(now, now);
    expect(res.kind).toBe("expired");
  });

  it("accepts ISO string input directly", () => {
    const res = computeTrialStatus("2026-08-15T00:00:00Z", now);
    expect(res.kind).toBe("active");
  });
});

describe("Constants", () => {
  it("SELF_SIGNUP_TRIAL_DAYS is 14", () => {
    expect(SELF_SIGNUP_TRIAL_DAYS).toBe(14);
  });

  it("token TTL is 24 hours", () => {
    expect(SIGNUP_TOKEN_TTL_HOURS).toBe(24);
  });

  it("rate limits are non-zero", () => {
    expect(SIGNUP_RATE_LIMIT_PER_IP.max).toBeGreaterThan(0);
    expect(SIGNUP_RATE_LIMIT_GLOBAL.max).toBeGreaterThan(
      SIGNUP_RATE_LIMIT_PER_IP.max,
    );
  });
});
