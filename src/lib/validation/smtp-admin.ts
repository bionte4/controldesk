import { z } from "zod";

/**
 * Zod schemas for the tenant SMTP admin surface (rules §17).
 *
 * Phase A ships SMTP only (nodemailer to any RFC 5321 relay). The
 * schema is a plain object rather than a discriminated union because
 * every SMTP-shaped relay — Gmail Workspace, Zoho, self-hosted MTA,
 * AWS SES SMTP endpoint, Postmark SMTP, etc. — uses the same tuple.
 * When a Phase B adds API-based adapters (Resend, Postmark JSON API,
 * SES SDK), we'll refactor to a discriminated union keyed on
 * `provider` — the DB CHECK already permits those values so the
 * migration path is a pure code change.
 *
 * Field notes:
 *   * `host` / `port` / `secure` — SMTP transport tuple. `secure` is
 *     optional; when omitted the mailer auto-detects (`465` → SMTPS,
 *     else STARTTLS-if-offered).
 *   * `username` / `password` — auth pair. Both nullable so anon
 *     relays (dev mailpit, internal MTAs on private network) work.
 *   * `from_address` / `from_name` / `reply_to` — RFC 5322 identity.
 *     `from_address` is required (must look like an email); the
 *     display name is optional; reply-to is optional and defaults to
 *     `from_address` when omitted.
 */

// Cheap email guard — RFC 5322 is a lot more permissive than this
// regex, but 99.9% of real inboxes match this shape. Full RFC 5322
// enforcement lives at the SMTP relay itself.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const smtpProviderEnum = z.enum([
  "SMTP",
  "RESEND",
  "POSTMARK",
  "SES",
  "SENDGRID",
]);
export type SmtpProviderInput = z.infer<typeof smtpProviderEnum>;

export const saveSmtpConfigSchema = z
  .object({
    provider: smtpProviderEnum.default("SMTP"),
    host: z
      .string()
      .trim()
      .min(3, "SMTP host is too short.")
      .max(255, "SMTP host is too long."),
    // Ports are 1-65535. Common values: 25 (SMTP), 465 (SMTPS),
    // 587 (submission), 1025 (mailpit dev), 2525 (SendGrid fallback).
    port: z
      .number({ error: "Port must be a number." })
      .int("Port must be an integer.")
      .min(1, "Port must be at least 1.")
      .max(65535, "Port cannot exceed 65535."),
    // Nullable so the mailer can auto-detect from port.
    secure: z.boolean().nullable().optional(),
    username: z
      .string()
      .trim()
      .max(255, "Username is too long.")
      .nullable()
      .optional(),
    password: z
      .string()
      .max(1024, "Password is too long.")
      .nullable()
      .optional(),
    from_address: z
      .string()
      .trim()
      .max(255)
      .refine((v) => EMAIL_PATTERN.test(v), {
        message: "From address must be a valid email (e.g. noreply@acme.com).",
      }),
    from_name: z
      .string()
      .trim()
      .max(120, "Display name is too long.")
      .nullable()
      .optional(),
    reply_to: z
      .string()
      .trim()
      .max(255)
      .nullable()
      .optional()
      .refine(
        (v) => v == null || v.length === 0 || EMAIL_PATTERN.test(v),
        {
          message:
            "Reply-to must be a valid email address or left blank.",
        },
      ),
  })
  .refine(
    (v) => {
      // If either username or password is provided, the other must be
      // provided too. A half-configured auth pair silently disables
      // AUTH on nodemailer, which then produces a confusing "relay
      // access denied" from the SMTP server.
      const hasUser = typeof v.username === "string" && v.username.length > 0;
      const hasPass = typeof v.password === "string" && v.password.length > 0;
      return hasUser === hasPass;
    },
    {
      message:
        "Provide both SMTP username and password, or leave both blank for anonymous relay.",
      path: ["password"],
    },
  );

export type SaveSmtpConfigInput = z.infer<typeof saveSmtpConfigSchema>;

/**
 * Deactivation carries no input from the client. Kept as an empty
 * object for wrapper uniformity.
 */
export const deactivateSmtpConfigSchema = z.object({});
export type DeactivateSmtpConfigInput = z.infer<
  typeof deactivateSmtpConfigSchema
>;
