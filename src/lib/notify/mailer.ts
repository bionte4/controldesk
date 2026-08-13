import "server-only";

import {
  loadTenantSmtpConfig,
  type TenantSmtpConfig,
} from "@/lib/integrations/smtp";
import { log } from "@/lib/observability/log";

/**
 * ControlDesk mailer (rules §20).
 *
 * A thin wrapper around `nodemailer` that:
 *   • Resolves SMTP config per tenant (from `tenant_smtp_configs`
 *     when `input.tenantId` is provided) or falls back to env-global
 *     SMTP_* vars when the tenant has no row or the send site is
 *     tenant-agnostic (e.g. workspace signup emails).
 *   • Falls back to a noop transport when SMTP is not configured
 *     anywhere (dev/test with `SMTP_HOST` unset).
 *   • Imports `nodemailer` via a plain `await import("nodemailer")`
 *     so Next.js's file tracer follows the reference and copies the
 *     SDK into `.next/standalone/node_modules/`. Nodemailer IS a
 *     hard dependency in `package.json` — the old `new Function
 *     ("spec", "return import(spec))` bypass was intentional at one
 *     point (to keep the tree clean on Edge / CI without the dep),
 *     but it broke Docker production builds by hiding the import
 *     from the tracer. Every workspace-signup email failed silently
 *     with "mailer: nodemailer unavailable, falling back to noop"
 *     until we removed the bypass.
 *
 * Contract:
 *   • Never throws. Failures are returned as `{status: "FAILED"}`.
 *   • `SKIPPED` means the mailer was intentionally short-circuited
 *     (no config), not that a send was attempted and failed.
 *   • Caller persists the outcome in `email_outbox` and uses the
 *     `from` field on the result to log the exact sender used.
 *
 * Resolution order for a given send:
 *   1. If `msg.tenantId` is provided AND `tenant_smtp_configs` has an
 *      active row for that tenant → use it.
 *   2. Otherwise, env-global `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER`
 *      / `SMTP_PASS` / `SMTP_FROM`.
 *   3. Otherwise, noop.
 *
 * The tenant path uses a **fresh transporter per tenant** — connection
 * pooling for one tenant's relay is not portable to another's, and
 * transactional email volume is low enough that a new TCP+TLS
 * handshake per send is acceptable. The env-global path keeps its
 * module-cached transporter across invocations (the connection pool
 * stays warm for the digest cron).
 */

export type EmailMessage = {
  to: string | readonly string[];
  subject: string;
  html?: string;
  text?: string;
  /** Optional per-message from override (rarely used). */
  from?: string;
  /** Reply-To header. Defaults to the tenant/env config `reply_to`. */
  replyTo?: string;
  metadata?: Record<string, unknown>;
  /**
   * Tenant scope for per-tenant SMTP resolution. When set, the mailer
   * loads `tenant_smtp_configs` first. Omit for tenant-agnostic sends
   * (e.g. workspace signup verification) — the env-global config is
   * used in that case.
   */
  tenantId?: string;
};

export type EmailResult = {
  status: "SENT" | "SKIPPED" | "FAILED";
  provider: "smtp" | "noop";
  /**
   * The `From:` value that was written on the wire. Callers persist
   * this in `email_outbox.from_address` so audit trails reflect the
   * ACTUAL sender (tenant relay vs env fallback), not just the env
   * default.
   */
  from?: string;
  /** Which config path was used (`tenant` = per-tenant row; `env` = global). */
  configSource?: "tenant" | "env";
  providerMessageId?: string;
  error?: string;
};

type NodemailerTransporter = {
  sendMail: (opts: Record<string, unknown>) => Promise<{ messageId?: string }>;
};

type EnvConfig = {
  source: "env";
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  replyTo?: string;
};

type TenantConfig = {
  source: "tenant";
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  replyTo?: string;
};

type ResolvedConfig = EnvConfig | TenantConfig;

function readEnvConfig(): EnvConfig | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT
    ? Number.parseInt(process.env.SMTP_PORT, 10)
    : 1025;
  const from =
    process.env.SMTP_FROM ?? "ControlDesk <no-reply@controldesk.app>";

  if (!host) return null;
  if (Number.isNaN(port) || port <= 0) return null;
  return {
    source: "env",
    host,
    port,
    secure: port === 465,
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from,
  };
}

/**
 * Convert a `TenantSmtpConfig` (from the repository) into the shape
 * the transporter factory expects. Ignores non-SMTP providers (they
 * would go through their own adapter — Phase A only ships SMTP).
 */
function tenantToConfig(cfg: TenantSmtpConfig): TenantConfig | null {
  if (cfg.provider !== "SMTP" || !cfg.isActive) return null;
  const secure = cfg.secure ?? cfg.port === 465;
  const displayName = cfg.fromName?.trim();
  // Render as RFC 5322: `"Display Name" <mailbox@host>` when a display
  // name is present, otherwise the bare mailbox.
  const from =
    displayName && displayName.length > 0
      ? `"${displayName.replace(/"/g, "'")}" <${cfg.fromAddress}>`
      : cfg.fromAddress;
  return {
    source: "tenant",
    host: cfg.host,
    port: cfg.port,
    secure,
    user: cfg.username ?? undefined,
    pass: cfg.password ?? undefined,
    from,
    replyTo: cfg.replyTo ?? undefined,
  };
}

async function resolveConfig(
  tenantId: string | undefined,
): Promise<ResolvedConfig | null> {
  if (tenantId) {
    try {
      const cfg = await loadTenantSmtpConfig(tenantId);
      if (cfg) {
        const t = tenantToConfig(cfg);
        if (t) return t;
        // Row exists but is inactive/unreadable — fall through to env.
        log.info("mailer: tenant SMTP row present but not usable", {
          tenant_id: tenantId,
          last_error: cfg.lastError,
        });
      }
    } catch (err) {
      // Never let a config loader failure block a send — degrade to env.
      log.warn("mailer: tenant SMTP load failed, falling back to env", {
        tenant_id: tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return readEnvConfig();
}

/**
 * Env-global transporter cache. Tenant transporters are one-shot
 * (see docblock above) to avoid cross-tenant credential reuse.
 */
let cachedEnvTransporter: NodemailerTransporter | null = null;

/**
 * Test hook — inject a transporter and short-circuit both paths.
 * Do not use outside of unit tests.
 */
export function __setTransporterForTests(
  t: NodemailerTransporter | null,
): void {
  cachedEnvTransporter = t;
  __testInjectedTransporter = t;
}

let __testInjectedTransporter: NodemailerTransporter | null = null;

async function buildTransporter(
  cfg: ResolvedConfig,
): Promise<NodemailerTransporter | null> {
  // Tests inject a fake transporter that must be used regardless of
  // config source, so a Vitest suite can assert on `sendMail` calls
  // without connecting to a real relay.
  if (__testInjectedTransporter) return __testInjectedTransporter;

  if (cfg.source === "env" && cachedEnvTransporter) {
    return cachedEnvTransporter;
  }

  try {
    // Plain `await import(...)` — NOT the historical `new Function`
    // bypass. See the module-level docblock for why: hiding the
    // import from Next.js's file tracer produced a standalone Docker
    // image without `nodemailer` in `node_modules`, and the mailer
    // silently fell back to noop for every signup email.
    const mod = (await import("nodemailer")) as unknown as {
      default?: { createTransport: (o: unknown) => NodemailerTransporter };
      createTransport?: (o: unknown) => NodemailerTransporter;
    };
    const factory =
      mod.createTransport ??
      (mod.default && "createTransport" in mod.default
        ? mod.default.createTransport.bind(mod.default)
        : undefined);
    if (!factory) return null;

    const transporter = factory({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    if (cfg.source === "env") cachedEnvTransporter = transporter;
    return transporter;
  } catch (err) {
    log.warn("mailer: nodemailer unavailable, falling back to noop", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const cfg = await resolveConfig(msg.tenantId);
  if (!cfg) {
    log.info("mailer: no SMTP config, skipping", {
      subject: msg.subject,
      tenant_id: msg.tenantId,
    });
    return { status: "SKIPPED", provider: "noop" };
  }

  const transporter = await buildTransporter(cfg);
  if (!transporter) {
    log.info("mailer: transporter unavailable, skipping", {
      subject: msg.subject,
      tenant_id: msg.tenantId,
    });
    return { status: "SKIPPED", provider: "noop" };
  }

  const from = msg.from ?? cfg.from;
  const replyTo = msg.replyTo ?? cfg.replyTo;

  try {
    const res = await transporter.sendMail({
      from,
      to: Array.isArray(msg.to) ? msg.to.join(", ") : msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo,
    });
    return {
      status: "SENT",
      provider: "smtp",
      from,
      configSource: cfg.source,
      providerMessageId: res.messageId,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("mailer: send failed", {
      error,
      subject: msg.subject,
      tenant_id: msg.tenantId,
      config_source: cfg.source,
    });
    return {
      status: "FAILED",
      provider: "smtp",
      from,
      configSource: cfg.source,
      error,
    };
  }
}
