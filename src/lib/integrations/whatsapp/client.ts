import "server-only";

import {
  loadTenantWhatsAppConfig,
  loadUserWhatsAppLink,
  type TenantWhatsAppConfig,
  type WhatsAppProvider,
} from "./repository";

/**
 * WhatsApp send-message client.
 *
 * Contract mirrors `telegram/client.ts`:
 *   * Always resolves — never throws. Failures return { ok: false, code }.
 *   * 5-second timeout so a slow provider can't wedge a Server Action.
 *   * Provider dispatch is behind a `switch(config.provider)` so
 *     Meta Cloud can be added later without changing call sites.
 *
 * Phase A ships **Twilio** only. Meta Cloud is stubbed with a
 * `NOT_IMPLEMENTED` result so the provider column is honoured but
 * tenants can't accidentally enable a code path we haven't wired.
 */

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_CONFIG"
      | "NO_LINK"
      | "NOT_IMPLEMENTED"
      | "HTTP"
      | "TIMEOUT"
      | "PROVIDER_ERROR",
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

const WA_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------
// Twilio adapter
// ---------------------------------------------------------------------

/**
 * Send a WhatsApp text via Twilio's `Messages` resource.
 *
 * Wire format: form-urlencoded POST to
 *   https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json
 * with basic auth (SID:token). Twilio returns 201 on success.
 *
 * Sandbox note: recipients must have joined the sandbox (they text
 * `join <two-words>` to Twilio's sandbox number first) before Twilio
 * accepts outbound messages to them. The "Send test" button
 * surfaces the provider error string so the user knows to join.
 */
async function sendViaTwilio(input: {
  config: TenantWhatsAppConfig;
  toE164: string;
  body: string;
}): Promise<
  | { ok: true; providerMessageId: string | null }
  | {
      ok: false;
      code: WhatsAppApiError["code"];
      error: string;
    }
> {
  if (!input.config.accountSid) {
    return {
      ok: false,
      code: "NO_CONFIG",
      error: "Twilio Account SID is not configured.",
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    input.config.accountSid,
  )}/Messages.json`;

  // Twilio expects `whatsapp:+E164` on both `From` and `To`. Config
  // may already include the prefix (for sandbox / production sender);
  // we tolerate both shapes.
  const from = input.config.phoneNumberId.startsWith("whatsapp:")
    ? input.config.phoneNumberId
    : `whatsapp:${input.config.phoneNumberId}`;
  const to = input.toE164.startsWith("whatsapp:")
    ? input.toE164
    : `whatsapp:${input.toE164}`;

  const params = new URLSearchParams();
  params.set("From", from);
  params.set("To", to);
  params.set("Body", input.body);

  const auth = Buffer.from(
    `${input.config.accountSid}:${input.config.apiToken}`,
  ).toString("base64");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: controller.signal,
    });
    const parsed = (await res.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      code?: number | string;
    };
    if (!res.ok) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        error: parsed.message ?? `Twilio HTTP ${res.status}`,
      };
    }
    return { ok: true, providerMessageId: parsed.sid ?? null };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "TIMEOUT", error: "Timeout after 5s." };
    }
    return {
      ok: false,
      code: "HTTP",
      error: err instanceof Error ? err.message : "Unknown error.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------
// Fonnte adapter (unofficial Indonesian WhatsApp gateway)
// ---------------------------------------------------------------------

/**
 * Send a WhatsApp text via Fonnte's `/send` endpoint.
 *
 * Wire format: form-urlencoded POST to `https://api.fonnte.com/send`
 * with an `Authorization: <device_token>` header (NO `Bearer`
 * prefix — Fonnte accepts the raw token). Success response is
 * `{ status: true, id: [...], target: [...] }`; failure is
 * `{ status: false, reason: "..." }`.
 *
 * Notes:
 *   * Fonnte accepts local Indonesian format (`08xxx`) or E.164
 *     (`628xxx`). We forward whatever the caller provided plus a
 *     `countryCode=62` default so a leading `0` is auto-rewritten
 *     to `62` by Fonnte (matches typical Indonesian tenant usage).
 *   * Strip a `whatsapp:` prefix if present — the personal linking
 *     flow may normalise to the Twilio format, and Fonnte would
 *     reject that shape.
 *   * Fonnte's device must be online (paired via QR + phone with
 *     WhatsApp Web logged in). A disconnected device returns
 *     `status:false` with a `device not connected`-ish reason.
 */
async function sendViaFonnte(input: {
  config: TenantWhatsAppConfig;
  toE164: string;
  body: string;
}): Promise<
  | { ok: true; providerMessageId: string | null }
  | { ok: false; code: WhatsAppApiError["code"]; error: string }
> {
  const target = input.toE164.startsWith("whatsapp:")
    ? input.toE164.slice("whatsapp:".length)
    : input.toE164;

  const params = new URLSearchParams();
  params.set("target", target);
  params.set("message", input.body);
  // Fonnte's `countryCode` replaces a leading `0` on the target
  // with the given country code. `62` is Indonesia.
  params.set("countryCode", "62");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WA_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: input.config.apiToken,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: controller.signal,
    });
    const parsed = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      id?: (string | number)[];
      reason?: string;
    };
    if (!res.ok || parsed.status !== true) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        error: parsed.reason ?? `Fonnte HTTP ${res.status}`,
      };
    }
    const firstId = parsed.id?.[0];
    return {
      ok: true,
      providerMessageId: firstId != null ? String(firstId) : null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "TIMEOUT", error: "Timeout after 5s." };
    }
    return {
      ok: false,
      code: "HTTP",
      error: err instanceof Error ? err.message : "Unknown error.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Send a WhatsApp message. Provider chosen from tenant config.
 *
 * Phase A: text-only via Twilio Sandbox / Production Sender. Phase B
 * will add Meta Cloud API + pre-approved templates for messages sent
 * outside the 24-hour window.
 */
export async function sendWhatsAppMessage(input: {
  tenantId: string;
  waId: string;
  text: string;
}): Promise<
  | { ok: true; providerMessageId: string | null; provider: WhatsAppProvider }
  | {
      ok: false;
      code: WhatsAppApiError["code"];
      error: string;
      provider?: WhatsAppProvider;
    }
> {
  const cfg = await loadTenantWhatsAppConfig(input.tenantId);
  if (!cfg || !cfg.isActive || !cfg.apiToken) {
    return {
      ok: false,
      code: "NO_CONFIG",
      error: "Tenant has not configured WhatsApp.",
    };
  }

  switch (cfg.provider) {
    case "TWILIO": {
      const res = await sendViaTwilio({
        config: cfg,
        toE164: input.waId,
        body: input.text,
      });
      if (res.ok) {
        return {
          ok: true,
          providerMessageId: res.providerMessageId,
          provider: cfg.provider,
        };
      }
      return { ...res, provider: cfg.provider };
    }
    case "META_CLOUD":
      // Deliberately not implemented in Phase A — see file docblock.
      return {
        ok: false,
        code: "NOT_IMPLEMENTED",
        error:
          "Meta Cloud API provider is not wired yet (Phase B). Switch tenant to TWILIO or wait for the Phase B release.",
        provider: cfg.provider,
      };
    case "FONNTE": {
      const res = await sendViaFonnte({
        config: cfg,
        toE164: input.waId,
        body: input.text,
      });
      if (res.ok) {
        return {
          ok: true,
          providerMessageId: res.providerMessageId,
          provider: cfg.provider,
        };
      }
      return { ...res, provider: cfg.provider };
    }
    default:
      return {
        ok: false,
        code: "NO_CONFIG",
        error: `Unknown WhatsApp provider: ${cfg.provider}`,
      };
  }
}

// ---------------------------------------------------------------------
// Credential verification (used by admin form BEFORE persisting).
// ---------------------------------------------------------------------

/**
 * Verify tenant-supplied WhatsApp credentials without side effects.
 * Called by the admin form to give immediate feedback before
 * `saveTenantWhatsAppConfig` writes to the encrypted store.
 *
 * Provider dispatch:
 *   * TWILIO     → GET /2010-04-01/Accounts/{sid}.json with basic auth.
 *                 Twilio returns the account JSON on success, and a
 *                 20xxx code on invalid credentials. Cheap.
 *   * META_CLOUD → GET graph.facebook.com/v18.0/{phone_number_id}
 *                 with bearer token. Meta returns the phone-number
 *                 profile on success, and an OAuthException on
 *                 invalid credentials.
 *
 * Both paths hard-cap at `WA_TIMEOUT_MS` so a slow provider cannot
 * wedge a Server Action while the admin waits at the form.
 */
export async function verifyWhatsAppCredentials(input: {
  provider: WhatsAppProvider;
  phoneNumberId: string;
  apiToken: string;
  accountSid?: string | null;
}): Promise<
  | { ok: true; providerAccountName: string | null }
  | { ok: false; code: WhatsAppApiError["code"]; error: string }
> {
  if (input.provider === "TWILIO") {
    if (!input.accountSid) {
      return {
        ok: false,
        code: "NO_CONFIG",
        error: "Twilio Account SID is required.",
      };
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      input.accountSid,
    )}.json`;
    const auth = Buffer.from(
      `${input.accountSid}:${input.apiToken}`,
    ).toString("base64");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WA_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
        signal: controller.signal,
      });
      const parsed = (await res.json().catch(() => ({}))) as {
        friendly_name?: string;
        message?: string;
        status?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          code: "PROVIDER_ERROR",
          error: parsed.message ?? `Twilio HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        providerAccountName: parsed.friendly_name ?? null,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, code: "TIMEOUT", error: "Timeout after 5s." };
      }
      return {
        ok: false,
        code: "HTTP",
        error: err instanceof Error ? err.message : "Unknown error.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (input.provider === "FONNTE") {
    // Fonnte exposes a `/device` endpoint that returns the paired
    // device profile when the token is valid. Payload includes
    // `device` (paired WA number), `status` ("connect" when the
    // Web session is live), `expired` (subscription end), and
    // quota counters. We keep the check simple: 200 + `status:true`
    // means the token can talk to Fonnte at all; connection-live
    // check happens at send time (surfaces a clearer error).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WA_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.fonnte.com/device", {
        method: "POST",
        headers: {
          Authorization: input.apiToken,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        signal: controller.signal,
      });
      const parsed = (await res.json().catch(() => ({}))) as {
        status?: boolean;
        device?: string;
        name?: string;
        reason?: string;
      };
      if (!res.ok || parsed.status !== true) {
        return {
          ok: false,
          code: "PROVIDER_ERROR",
          error: parsed.reason ?? `Fonnte HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        providerAccountName: parsed.name ?? parsed.device ?? null,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, code: "TIMEOUT", error: "Timeout after 5s." };
      }
      return {
        ok: false,
        code: "HTTP",
        error: err instanceof Error ? err.message : "Unknown error.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (input.provider === "META_CLOUD") {
    const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(
      input.phoneNumberId,
    )}?fields=display_phone_number,verified_name`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WA_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${input.apiToken}` },
        signal: controller.signal,
      });
      const parsed = (await res.json().catch(() => ({}))) as {
        verified_name?: string;
        display_phone_number?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          code: "PROVIDER_ERROR",
          error: parsed.error?.message ?? `Meta HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        providerAccountName:
          parsed.verified_name ?? parsed.display_phone_number ?? null,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, code: "TIMEOUT", error: "Timeout after 5s." };
      }
      return {
        ok: false,
        code: "HTTP",
        error: err instanceof Error ? err.message : "Unknown error.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    code: "NO_CONFIG",
    error: `Unknown WhatsApp provider: ${String(input.provider)}`,
  };
}

/**
 * Send the canonical "test" message to the user's linked WhatsApp
 * number, used by the "Send test" button in Preferences.
 */
export async function sendWhatsAppTest(input: {
  tenantId: string;
  userId: string;
  locale: "id" | "en";
}): Promise<
  | { ok: true; providerMessageId: string | null }
  | { ok: false; code: WhatsAppApiError["code"]; error: string }
> {
  const link = await loadUserWhatsAppLink({
    tenantId: input.tenantId,
    userId: input.userId,
  });
  if (!link) {
    return {
      ok: false,
      code: "NO_LINK",
      error: "User has not linked their WhatsApp number.",
    };
  }

  const text =
    input.locale === "id"
      ? "*ControlDesk WhatsApp terhubung ✅*\nNotifikasi ControlDesk akan dikirim ke nomor ini."
      : "*ControlDesk WhatsApp is linked ✅*\nControlDesk notifications will land here.";

  const res = await sendWhatsAppMessage({
    tenantId: input.tenantId,
    waId: link.waId,
    text,
  });
  if (!res.ok) {
    return { ok: false, code: res.code, error: res.error };
  }
  return { ok: true, providerMessageId: res.providerMessageId };
}
