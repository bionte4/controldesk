import "server-only";

import { log } from "@/lib/observability/log";

/**
 * ControlDesk mailer (rules §20).
 *
 * A thin wrapper around `nodemailer` that:
 *   • reads SMTP config from env,
 *   • falls back to a `NoopTransport` when SMTP is not configured (dev/test),
 *   • dynamically imports `nodemailer` so the module tree stays clean when
 *     the runtime does not need it (edge functions, unit tests, CI without
 *     the dependency installed).
 *
 * Callers should NOT catch failures — the digest cron persists results in
 * `email_outbox`, so any thrown error surfaces there.
 */

export type EmailMessage = {
  to: string | readonly string[];
  subject: string;
  html?: string;
  text?: string;
  /** Optional per-message from override. */
  from?: string;
  /** Reply-To header (defaults to `from`). */
  replyTo?: string;
  metadata?: Record<string, unknown>;
};

export type EmailResult = {
  status: "SENT" | "SKIPPED" | "FAILED";
  provider: "smtp" | "noop";
  providerMessageId?: string;
  error?: string;
};

type NodemailerTransporter = {
  sendMail: (opts: Record<string, unknown>) => Promise<{ messageId?: string }>;
};

type Config = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};

function readConfig(): Config | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT
    ? Number.parseInt(process.env.SMTP_PORT, 10)
    : 1025;
  const from = process.env.SMTP_FROM ?? "ControlDesk <no-reply@controldesk.app>";

  if (!host) return null;
  if (Number.isNaN(port) || port <= 0) return null;
  return {
    host,
    port,
    // Port 465 is legacy TLS; everything else is STARTTLS-capable, plaintext
    // in dev (mailpit 1025).
    secure: port === 465,
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from,
  };
}

// Cached transport reused across invocations to keep the connection pool warm.
let cachedTransporter: NodemailerTransporter | null = null;

/**
 * Test hook — inject a transporter and short-circuit `getTransporter`.
 * Do not use outside of unit tests.
 */
export function __setTransporterForTests(
  t: NodemailerTransporter | null,
): void {
  cachedTransporter = t;
}

async function getTransporter(
  cfg: Config,
): Promise<NodemailerTransporter | null> {
  if (cachedTransporter) return cachedTransporter;
  try {
    // Dynamic import via Function() so TS/webpack keep `nodemailer` optional.
    const dyn = new Function(
      "spec",
      "return import(spec);",
    ) as (spec: string) => Promise<unknown>;
    const mod = (await dyn("nodemailer")) as {
      default?: { createTransport: (o: unknown) => NodemailerTransporter };
      createTransport?: (o: unknown) => NodemailerTransporter;
    };
    const factory =
      mod.createTransport ??
      (mod.default && "createTransport" in mod.default
        ? mod.default.createTransport.bind(mod.default)
        : undefined);
    if (!factory) return null;

    cachedTransporter = factory({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    return cachedTransporter;
  } catch (err) {
    log.warn("mailer: nodemailer unavailable, falling back to noop", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const cfg = readConfig();
  if (!cfg) {
    log.info("mailer: SMTP not configured, skipping", {
      subject: msg.subject,
    });
    return { status: "SKIPPED", provider: "noop" };
  }

  const transporter = await getTransporter(cfg);
  if (!transporter) {
    log.info("mailer: transporter unavailable, skipping", {
      subject: msg.subject,
    });
    return { status: "SKIPPED", provider: "noop" };
  }

  try {
    const res = await transporter.sendMail({
      from: msg.from ?? cfg.from,
      to: Array.isArray(msg.to) ? msg.to.join(", ") : msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: msg.replyTo,
    });
    return {
      status: "SENT",
      provider: "smtp",
      providerMessageId: res.messageId,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("mailer: send failed", { error, subject: msg.subject });
    return { status: "FAILED", provider: "smtp", error };
  }
}
