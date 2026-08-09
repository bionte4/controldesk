/**
 * Pure helpers for tenant provisioning (docs/ops/tenant-provisioning.md).
 *
 * Used by:
 *   • scripts/tenant/create.ts — the `pnpm tenant:create` CLI (Fase 1).
 *   • (Future) src/app/(super-admin)/tenants/actions.ts — admin UI (Fase 2).
 *
 * Kept side-effect-free (no Supabase, no I/O) so Vitest exercises them
 * under the standard `src/**` suite without stubs.
 */

import { randomBytes } from "node:crypto";

/**
 * Reserved slugs mirror RESERVED_SUBDOMAINS in src/lib/tenant/resolve.ts.
 * Duplicated (not re-exported) because the two files serve different
 * enforcement points — resolve.ts guards inbound requests, this file
 * guards *outbound* tenant creation. Keeping them separate makes
 * future divergence (e.g. tighter provisioning list) explicit.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "admin",
  "auth",
  "assets",
  "static",
  "cdn",
  "mail",
  "docs",
]);

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Generous email regex — the real authority is Supabase Auth, which
 *  will reject invalid addresses when the auth user is created. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ParsedProvisioningArgs = {
  slug: string;
  name: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string | null;
  dryRun: boolean;
  skipCoa: boolean;
  yes: boolean;
  source: string;
  /**
   * Fase 4 (Aug 2026). When true, the CLI attempts to send the welcome
   * email via env-scoped SMTP (SMTP_HOST/PORT/USER/PASS/FROM) after a
   * successful provisioning. When false (default), the CLI only prints
   * the email to stdout for the operator to send manually. Kept as an
   * opt-in so a broken SMTP config never causes accidental sends to
   * the wrong address.
   */
  sendEmail: boolean;
};

export type ProvisioningParseError = { code: string; message: string };

export type ParseResult =
  | { ok: true; value: ParsedProvisioningArgs }
  | { ok: false; error: ProvisioningParseError };

/**
 * Parse `process.argv.slice(2)`-style tokens into validated args.
 * Returns a discriminated union so callers can pattern-match without
 * try/catch. Accepts `--flag` (boolean) and `--key=value` forms.
 */
export function parseProvisioningArgs(argv: readonly string[]): ParseResult {
  const map = new Map<string, string>();
  const flags = new Set<string>();

  for (const raw of argv) {
    if (
      raw === "--dry-run" ||
      raw === "--skip-coa" ||
      raw === "--yes" ||
      raw === "--send-email"
    ) {
      flags.add(raw.slice(2));
      continue;
    }
    const eq = raw.indexOf("=");
    if (raw.startsWith("--") && eq > 2) {
      const key = raw.slice(2, eq);
      const value = raw.slice(eq + 1);
      map.set(key, value);
      continue;
    }
    return {
      ok: false,
      error: {
        code: "UNKNOWN_ARG",
        message: `Unknown argument: ${raw}. Use --key=value or one of --dry-run/--skip-coa/--yes.`,
      },
    };
  }

  const slug = (map.get("slug") ?? "").trim().toLowerCase();
  const name = (map.get("name") ?? "").trim();
  const adminEmail = (map.get("admin-email") ?? "").trim().toLowerCase();
  const adminName = (map.get("admin-name") ?? "").trim();
  const rawPw = map.get("admin-password");
  const adminPassword = rawPw === undefined ? null : rawPw;
  const source = (map.get("source") ?? "ops-cli").trim();

  if (!slug) {
    return { ok: false, error: { code: "SLUG_MISSING", message: "--slug is required." } };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: {
        code: "SLUG_INVALID",
        message: `Slug '${slug}' must match ^[a-z0-9][a-z0-9-]{1,62}$ (lowercase alphanumerics + hyphens, 2–63 chars, must start with alphanumeric).`,
      },
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return {
      ok: false,
      error: {
        code: "SLUG_RESERVED",
        message: `Slug '${slug}' is reserved (used by the app itself). Pick another.`,
      },
    };
  }

  if (!name) {
    return { ok: false, error: { code: "NAME_MISSING", message: "--name is required." } };
  }
  if (name.length < 2 || name.length > 200) {
    return {
      ok: false,
      error: { code: "NAME_INVALID", message: "--name must be 2–200 characters." },
    };
  }

  if (!adminEmail) {
    return {
      ok: false,
      error: { code: "ADMIN_EMAIL_MISSING", message: "--admin-email is required." },
    };
  }
  if (!EMAIL_PATTERN.test(adminEmail)) {
    return {
      ok: false,
      error: { code: "ADMIN_EMAIL_INVALID", message: `Invalid email: ${adminEmail}.` },
    };
  }

  if (!adminName) {
    return {
      ok: false,
      error: { code: "ADMIN_NAME_MISSING", message: "--admin-name is required." },
    };
  }
  if (adminName.length < 2 || adminName.length > 200) {
    return {
      ok: false,
      error: { code: "ADMIN_NAME_INVALID", message: "--admin-name must be 2–200 characters." },
    };
  }

  if (adminPassword !== null && adminPassword.length < 12) {
    return {
      ok: false,
      error: {
        code: "PASSWORD_WEAK",
        message: "--admin-password must be at least 12 characters. Omit to auto-generate.",
      },
    };
  }

  return {
    ok: true,
    value: {
      slug,
      name,
      adminEmail,
      adminName,
      adminPassword,
      dryRun: flags.has("dry-run"),
      skipCoa: flags.has("skip-coa"),
      yes: flags.has("yes"),
      source,
      sendEmail: flags.has("send-email"),
    },
  };
}

/**
 * Cryptographically-strong password suitable for a first login.
 * base64url output (URL-safe, no `+` / `/` / `=`) so operators can
 * paste it into email templates or password managers without escaping.
 * 24 random bytes → 32 base64url chars, well above the 12-char minimum
 * Supabase Auth enforces.
 */
export function generateSecurePassword(): string {
  return randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Render the plain-text welcome email that the operator sends to the
 * new Tenant Admin. Structure kept identical to the template in
 * docs/ops/tenant-provisioning.md — update both if you change one.
 */
export function renderWelcomeEmail(params: {
  tenantName: string;
  tenantSlug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  rootDomain: string;
}): { subject: string; body: string } {
  const url = `https://${params.tenantSlug}.${params.rootDomain}/login`;
  const subject = `Selamat datang di ControlDesk — ${params.tenantName}`;
  const body = `Halo ${params.adminName},

Akun ControlDesk untuk ${params.tenantName} sudah aktif. Silakan
login untuk mulai onboarding.

URL:      ${url}
Email:    ${params.adminEmail}
Password: ${params.adminPassword}

Wajib segera setelah login:
1. Ganti password (menu Profile).
2. Setup email SMTP (Settings → Integrations → Email) supaya
   notifikasi ke tim Anda terkirim.
3. Undang tim Anda (Settings → Users → Invite).

Bahan bacaan onboarding:
- Panduan pengguna:    https://docs.controldesk.app/user-guides/internal-users
- Alur kerja per role: https://docs.controldesk.app/training/user-guide-workflows
- Materi training:     https://docs.controldesk.app/training/README

Kalau ada kendala, balas email ini atau kontak support@controldesk.app.

Salam,
Tim ControlDesk`;
  return { subject, body };
}

export const PROVISIONING_USAGE = `
pnpm tenant:create — provision a new ControlDesk tenant.

Required:
  --slug=<slug>              Subdomain slug (^[a-z0-9][a-z0-9-]{1,62}$).
                             Cannot be reserved (www/app/api/admin/…).
  --name=<name>              Legal name of the organization.
  --admin-email=<email>      Email of the initial Tenant Admin.
  --admin-name=<full name>   Full name of the initial Tenant Admin.

Optional:
  --admin-password=<pw>      Password (>=12 chars). Auto-generated if omitted.
  --source=<label>           Audit metadata (default: ops-cli).
  --dry-run                  Validate + preflight only. Do not mutate DB.
  --skip-coa                 Skip Chart of Accounts seeding (edge cases).
  --yes                      Non-interactive; skip confirmation prompt.
  --send-email               Send welcome email via env SMTP (Fase 4).
                             Falls back to stdout print if SMTP_HOST unset.

Environment (must be set in .env.local or shell):
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  NEXT_PUBLIC_ROOT_DOMAIN     (default: controldesk.app)

For --send-email (all optional; missing SMTP_HOST short-circuits to
stdout with a warning so no accidental partial config is used):
  SMTP_HOST                   e.g. smtp.gmail.com
  SMTP_PORT                   default 587
  SMTP_USER                   auth username
  SMTP_PASS                   auth password / app password
  SMTP_FROM                   From header (default: ControlDesk <no-reply@controldesk.app>)

Examples:
  pnpm tenant:create --slug=acme --name="PT Acme" \\
       --admin-email=admin@acme.co.id --admin-name="Budi Santoso"

  pnpm tenant:create --slug=acme --name="PT Acme" \\
       --admin-email=admin@acme.co.id --admin-name="Budi Santoso" \\
       --dry-run

See docs/ops/tenant-provisioning.md for the full runbook.`.trim();
