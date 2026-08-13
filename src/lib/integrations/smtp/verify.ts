import "server-only";

import { log } from "@/lib/observability/log";

/**
 * Verify SMTP credentials without sending a real message.
 *
 * Uses nodemailer's `verify()` which:
 *   1. Establishes a connection to the SMTP host on the given port.
 *   2. Performs the STARTTLS/TLS negotiation.
 *   3. Runs an AUTH round-trip when credentials are provided.
 *   4. Sends a QUIT and closes the socket without transmitting mail.
 *
 * This is the same protocol handshake `sendMail()` would perform,
 * so a successful verify is a strong signal that the tenant's
 * transport tuple is correct (auth + TLS + firewall reachability).
 * A `MAIL FROM` policy violation (e.g. sender domain not allowed on
 * this relay) is still discovered at first real send, but the
 * common misconfigurations (wrong password, wrong port, TLS off on
 * a TLS-only relay) are caught here.
 *
 * Imports `nodemailer` via plain `await import("nodemailer")` so the
 * Next.js file tracer follows the reference and copies the SDK into
 * `.next/standalone/node_modules/`. See `mailer.ts` for the full
 * rationale — the old `new Function` bypass silently broke the
 * verify roundtrip inside the Docker `runner` image.
 */
export async function verifySmtpCredentials(input: {
  host: string;
  port: number;
  secure: boolean | null;
  username: string | null;
  password: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  try {
    const mod = (await import("nodemailer")) as unknown as {
      default?: { createTransport: (o: unknown) => VerifiableTransporter };
      createTransport?: (o: unknown) => VerifiableTransporter;
    };
    const factory =
      mod.createTransport ??
      (mod.default && "createTransport" in mod.default
        ? mod.default.createTransport.bind(mod.default)
        : undefined);
    if (!factory) {
      return {
        ok: false,
        error:
          "nodemailer is not installed in this runtime. Cannot verify SMTP.",
      };
    }

    // If `secure` is null, auto-detect: port 465 → SMTPS, else STARTTLS.
    // Matches the fallback logic in mailer.ts::readConfig.
    const secure = input.secure ?? input.port === 465;

    const transporter = factory({
      host: input.host,
      port: input.port,
      secure,
      auth:
        input.username && input.password
          ? { user: input.username, pass: input.password }
          : undefined,
      // Short timeouts — a slow relay must not wedge the admin form.
      // These are default nodemailer options that get passed through.
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });

    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.info("smtp: verify failed", { host: input.host, error });
    return { ok: false, error };
  }
}

type VerifiableTransporter = {
  verify: () => Promise<true>;
};
