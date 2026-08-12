/**
 * Self-signup pure helpers (Fase 6, migration 0078).
 *
 * Kept side-effect-free + Node-native (crypto only) so they can be
 * unit-tested + reused by both the /register-org Server Action AND
 * any future CLI or admin surface that wants to create signup
 * requests programmatically.
 *
 * NOT re-exported from `tenant-provisioning.ts` because that file is
 * already large and its consumers (CLI, super-admin UI) don't need
 * the signup-token machinery.
 */

import { createHash, randomBytes } from "node:crypto";

import { renderEmailBody } from "@/lib/notify/templates/skeleton";

/**
 * Trial length applied to every self-signup tenant. Enforced by the
 * DB function `complete_tenant_signup` (migration 0078). Keep in sync
 * with docs/ops/tenant-provisioning.md — copy this constant if you
 * ever branch the value per plan tier.
 */
export const SELF_SIGNUP_TRIAL_DAYS = 14;

/**
 * How long a verification token stays valid. After this window the
 * signup request is unusable and the user must re-submit the form.
 * Kept short (24h) because email delivery is usually seconds — a
 * long window mostly benefits attackers who steal a request token.
 */
export const SIGNUP_TOKEN_TTL_HOURS = 24;

/**
 * Rate limits applied at the `/register-org` Server Action. Two
 * independent buckets so we catch both single-attacker floods (per-IP)
 * AND global abuse (spammer rotating IPs).
 */
export const SIGNUP_RATE_LIMIT_PER_IP = {
  max: 5,
  windowSeconds: 60 * 60, // 5 attempts per IP per hour
} as const;

export const SIGNUP_RATE_LIMIT_GLOBAL = {
  max: 50,
  windowSeconds: 60 * 60, // 50 attempts globally per hour
} as const;

// ---------------------------------------------------------------------------
// Token generation + hashing
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically strong signup verification token.
 *
 * 32 bytes → 43-char base64url. Long enough to make brute-force
 * infeasible even with unbounded requests (2^256 space) while
 * remaining short enough to fit in a URL without wrapping in email
 * clients.
 *
 * Returns the RAW token (goes into the verify link) and its sha256
 * hash (persisted to `tenant_signup_requests.token_hash`). Only the
 * hash lands in the DB — the raw is emailed to the user and never
 * stored on our side.
 */
export function generateSignupToken(): { raw: string; hash: string } {
  const bytes = randomBytes(32);
  const raw = bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const hash = hashSignupToken(raw);
  return { raw, hash };
}

export function hashSignupToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ---------------------------------------------------------------------------
// Verification email body
// ---------------------------------------------------------------------------

export type SignupEmailInput = {
  tenantName: string;
  slug: string;
  adminName: string;
  verifyUrl: string;
  ttlHours?: number;
};

export type RenderedEmail = { subject: string; text: string; html: string };

export function renderSignupVerificationEmail(
  input: SignupEmailInput,
): RenderedEmail {
  const ttl = input.ttlHours ?? SIGNUP_TOKEN_TTL_HOURS;
  const subject = `Konfirmasi pendaftaran ${input.tenantName} di ControlDesk`;
  const { text, html } = renderEmailBody({
    title: subject,
    preheader: `Klik untuk verifikasi ${input.tenantName} — link ${ttl} jam.`,
    greeting: `Halo ${input.adminName},`,
    sections: [
      {
        body: `Terima kasih sudah mendaftarkan ${input.tenantName} (slug: ${input.slug}) ke ControlDesk. Klik tombol di bawah untuk menyelesaikan verifikasi email Anda.`,
      },
      {
        heading: "Detail",
        items: [
          `Nama workspace: ${input.tenantName}`,
          `Alamat login: ${input.slug}.controldesk.app`,
          `Masa uji coba setelah verifikasi: ${SELF_SIGNUP_TRIAL_DAYS} hari`,
          `Link kadaluarsa dalam: ${ttl} jam`,
        ],
      },
      {
        body: "Kalau bukan Anda yang mendaftar, cukup abaikan email ini — tanpa klik verifikasi, workspace tidak akan dibuat dan permintaan otomatis kadaluarsa.",
      },
    ],
    cta: {
      label: "Verifikasi email saya",
      url: input.verifyUrl,
    },
  });
  return { subject, text, html };
}

export type SignupConfirmationEmailInput = {
  tenantName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  loginUrl: string;
  trialDays?: number;
};

/**
 * The post-verification "your workspace is ready" email. Sent after
 * complete_tenant_signup succeeds so the user has credentials in
 * hand alongside the browser confirmation page (they might not save
 * the tab).
 */
export function renderSignupConfirmationEmail(
  input: SignupConfirmationEmailInput,
): RenderedEmail {
  const trial = input.trialDays ?? SELF_SIGNUP_TRIAL_DAYS;
  const subject = `Workspace ${input.tenantName} siap — kredensial admin`;
  const credentialsBlock = [
    `URL      : ${input.loginUrl}`,
    `Email    : ${input.adminEmail}`,
    `Password : ${input.adminPassword}`,
  ].join("\n");
  const { text, html } = renderEmailBody({
    tenantName: input.tenantName,
    title: subject,
    preheader: `Login admin siap. Uji coba ${trial} hari aktif otomatis.`,
    greeting: `Halo ${input.adminName},`,
    sections: [
      {
        body: `Workspace ControlDesk untuk ${input.tenantName} sudah aktif. Simpan kredensial di bawah dengan aman — password ini hanya ditampilkan sekali.`,
      },
      {
        heading: "Kredensial admin",
        body: "Password wajib diganti dari menu Profile setelah login pertama.",
      },
      {
        preformatted: credentialsBlock,
      },
      {
        heading: "Langkah selanjutnya",
        items: [
          "Login pakai kredensial di atas dan ganti password default.",
          "Undang tim Anda dari Settings → Users.",
          "Setup SMTP tenant di Settings → Integrations → Email supaya notifikasi ke domain sendiri.",
          `Uji coba ${trial} hari aktif — semua fitur terbuka. Setelah itu hubungi sales@controldesk.app untuk paket berbayar.`,
        ],
      },
      {
        heading: "Bahan bacaan",
        items: [
          "Panduan pengguna: https://docs.controldesk.app/user-guides/internal-users",
          "Alur kerja per role: https://docs.controldesk.app/training/user-guide-workflows",
        ],
      },
    ],
    cta: {
      label: "Buka workspace",
      url: input.loginUrl,
    },
  });
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Same tenant-slug regex as `tenant-provisioning.ts` — kept locally
 * so the self-signup path doesn't reach into an admin-only module.
 * If you change this, update `tenant-provisioning.ts` in lockstep.
 */
export const SIGNUP_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * Slugs we refuse for self-signup, on top of anything the DB rejects
 * via the tenants_slug_check constraint. Superset of RESERVED_SLUGS
 * in tenant-provisioning.ts (adds a few marketing paths we don't
 * want confused with tenants).
 */
export const SIGNUP_RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "api",
  "admin",
  "app",
  "auth",
  "docs",
  "help",
  "support",
  "status",
  "blog",
  "marketing",
  "sales",
  "register",
  "signup",
  "super-admin",
  "console",
  "dashboard",
  "portal",
  "static",
  "assets",
  "cdn",
  "mail",
  "email",
  "smtp",
  "controldesk",
  "test",
  "staging",
  "prod",
  "production",
]);

/**
 * RFC-5322-simple email regex. Not perfect (nothing is) but rejects
 * obvious garbage. The mailer's SMTP send will catch anything past
 * this that turns out to be undeliverable.
 */
export const SIGNUP_EMAIL_PATTERN =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export type ValidationIssue = { field: string; message: string };

export function validateSignupInput(input: {
  slug: string;
  name: string;
  adminEmail: string;
  adminName: string;
}): { ok: true } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const slug = input.slug.trim().toLowerCase();
  if (!SIGNUP_SLUG_PATTERN.test(slug)) {
    issues.push({
      field: "slug",
      message:
        "Slug harus 2–63 karakter, huruf kecil / angka / tanda hubung (-), tidak diawali/diakhiri tanda hubung.",
    });
  } else if (SIGNUP_RESERVED_SLUGS.has(slug)) {
    issues.push({
      field: "slug",
      message: "Slug ini reserved oleh sistem. Silakan pilih yang lain.",
    });
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 200) {
    issues.push({
      field: "name",
      message: "Nama organisasi 2–200 karakter.",
    });
  }
  const email = input.adminEmail.trim().toLowerCase();
  if (!SIGNUP_EMAIL_PATTERN.test(email)) {
    issues.push({ field: "adminEmail", message: "Format email tidak valid." });
  }
  const adminName = input.adminName.trim();
  if (adminName.length < 2 || adminName.length > 200) {
    issues.push({ field: "adminName", message: "Nama admin 2–200 karakter." });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Trial expiry math (used by the in-app banner)
// ---------------------------------------------------------------------------

export type TrialStatus =
  | { kind: "not_on_trial" }
  | { kind: "active"; daysRemaining: number; endsAt: Date }
  | { kind: "expired"; expiredAt: Date; daysSince: number };

/**
 * Compute trial status from a `trial_ends_at` timestamp. Kept pure
 * so the banner + super-admin dashboard can both format the same way.
 *
 * `now` parameter defaults to `new Date()` — override for tests.
 */
export function computeTrialStatus(
  trialEndsAt: Date | string | null | undefined,
  now: Date = new Date(),
): TrialStatus {
  if (!trialEndsAt) return { kind: "not_on_trial" };
  const endsAt =
    trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  if (Number.isNaN(endsAt.getTime())) return { kind: "not_on_trial" };
  const diffMs = endsAt.getTime() - now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (diffMs <= 0) {
    return {
      kind: "expired",
      expiredAt: endsAt,
      daysSince: Math.ceil(-diffMs / dayMs),
    };
  }
  return {
    kind: "active",
    daysRemaining: Math.ceil(diffMs / dayMs),
    endsAt,
  };
}
