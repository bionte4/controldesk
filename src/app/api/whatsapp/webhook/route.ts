import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

import {
  decodeWhatsAppLinkToken,
  loadTenantWhatsAppConfig,
  saveUserWhatsAppLink,
  sendWhatsAppMessage,
  touchInboundTimestamp,
} from "@/lib/integrations/whatsapp";
import { log } from "@/lib/observability/log";

/**
 * WhatsApp webhook — handles inbound `/start <token>` messages that
 * complete the click-to-chat linking flow.
 *
 * Two providers, two request shapes:
 *
 * 1. **Twilio** — POSTs `application/x-www-form-urlencoded`:
 *      From=whatsapp:+62812xxxxxx
 *      To=whatsapp:+1415xxxxxxx    ← the tenant's business number
 *      Body=/start <token>
 *      ProfileName=Bontea
 *    Auth: HMAC-SHA1 of `<url><sorted_params>` using tenant's Auth
 *    Token, in the `X-Twilio-Signature` header.
 *    In dev the sandbox does not sign requests — we accept unsigned
 *    only when `NODE_ENV !== "production"`.
 *
 * 2. **Meta WhatsApp Cloud API** — GET verification handshake
 *    (`?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`)
 *    plus POST JSON updates. Not wired in Phase A (see
 *    `client.ts` NOT_IMPLEMENTED); the route stubs the verify path
 *    so admins can still complete Meta's subscription flow before
 *    Phase B ships.
 *
 * The route discovers the tenant from the deep-link token, not from
 * host/URL, so multi-tenant deployments can share one webhook URL.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------
// GET — Meta Cloud API verification handshake.
// ---------------------------------------------------------------------
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !verifyToken || !challenge) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // We don't know the tenant yet (Meta only sends the verify_token),
  // so any tenant using this token matches. If more than one tenant
  // shares a verify token that's their choice — it just means their
  // handshakes cross-authenticate; the *actual* message delivery
  // still gates on the encrypted API token per tenant.
  const globalToken = process.env.WHATSAPP_META_VERIFY_TOKEN;
  if (globalToken && verifyToken === globalToken) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

// ---------------------------------------------------------------------
// POST — inbound message dispatch.
// ---------------------------------------------------------------------
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  // Twilio uses form-urlencoded; Meta uses application/json. We
  // switch on the content-type header rather than sniffing the body.
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return handleTwilioPost(request);
  }
  if (contentType.includes("application/json")) {
    return handleMetaPost(request);
  }
  return NextResponse.json({ ok: false }, { status: 415 });
}

// ---------------------------------------------------------------------
// Twilio handler.
// ---------------------------------------------------------------------

async function handleTwilioPost(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);

  const from = params.get("From") ?? ""; // whatsapp:+62812xxxxxx
  const body = (params.get("Body") ?? "").trim();
  const profileName = params.get("ProfileName");
  const twilioSignature = request.headers.get("x-twilio-signature");

  if (!from || !body) {
    return NextResponse.json({ ok: true }); // ack no-op
  }

  // We only recognise `/start <token>` for now. Any other inbound
  // message is silently ack'd — Phase B will handle reply-driven
  // conversations.
  if (!body.startsWith("/start")) {
    return NextResponse.json({ ok: true });
  }

  const token = body.split(/\s+/, 2)[1];
  if (!token) {
    return NextResponse.json({ ok: true });
  }

  const decoded = decodeWhatsAppLinkToken(token);
  if (!decoded.ok) {
    log.warn("whatsapp_link_token_invalid", { reason: decoded.reason });
    return NextResponse.json({ ok: true });
  }

  // Now we know the tenant — verify Twilio signature using their
  // Auth Token. In dev / sandbox we accept unsigned requests.
  const cfg = await loadTenantWhatsAppConfig(decoded.tenantId);
  if (!cfg || cfg.provider !== "TWILIO") {
    log.warn("whatsapp_webhook_wrong_provider", {
      tenantId: decoded.tenantId,
      provider: cfg?.provider,
    });
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (process.env.NODE_ENV === "production") {
    if (!twilioSignature || !cfg.apiToken) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    if (!verifyTwilioSignature({
      authToken: cfg.apiToken,
      signature: twilioSignature,
      fullUrl: request.url,
      params,
    })) {
      log.warn("whatsapp_twilio_signature_invalid", {
        tenantId: decoded.tenantId,
      });
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  // Strip `whatsapp:` prefix — we store E.164 (`+62812...`) so
  // outbound + inbound bookkeeping is provider-neutral.
  const waId = from.replace(/^whatsapp:/, "");

  try {
    await saveUserWhatsAppLink({
      tenantId: decoded.tenantId,
      userId: decoded.userId,
      waId,
      profileName,
    });
    await touchInboundTimestamp({
      tenantId: decoded.tenantId,
      userId: decoded.userId,
    });
  } catch (err) {
    log.error("whatsapp_link_save_failed", {
      err: err instanceof Error ? err.message : String(err),
      tenantId: decoded.tenantId,
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // Fire a confirmation reply. Best-effort — even if this fails, the
  // linking succeeded (row is in the DB).
  await sendWhatsAppMessage({
    tenantId: decoded.tenantId,
    waId,
    text:
      "*ControlDesk terhubung ✅*\nNotifikasi ControlDesk akan dikirim ke nomor ini.\n\n_ControlDesk is now linked. Notifications will land here._",
  });

  // Twilio expects an empty TwiML response so it doesn't auto-reply.
  return new Response("<Response></Response>", {
    status: 200,
    headers: { "content-type": "application/xml" },
  });
}

/**
 * Twilio's HMAC-SHA1 signature scheme.
 *
 * Algorithm: base64( HMAC-SHA1( `${url}${sortedFormPairs}`, authToken ) )
 * where `sortedFormPairs` is `key1value1key2value2...` (no separator)
 * over params sorted lexicographically by key.
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function verifyTwilioSignature(input: {
  authToken: string;
  signature: string;
  fullUrl: string;
  params: URLSearchParams;
}): boolean {
  const sortedKeys = Array.from(input.params.keys()).sort();
  const concat = sortedKeys
    .map((k) => `${k}${input.params.get(k) ?? ""}`)
    .join("");
  const data = input.fullUrl + concat;
  const digest = createHmac("sha1", input.authToken).update(data).digest();
  const expected = digest.toString("base64");
  const providedBuf = Buffer.from(input.signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  try {
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Meta stub — Phase B will fill this in.
// ---------------------------------------------------------------------

async function handleMetaPost(_request: Request): Promise<Response> {
  // Meta Cloud API sends `entry[].changes[].value.messages[].text.body`.
  // Phase A does not send via Meta and does not process its inbound
  // deliveries either; we ack so Meta doesn't retry indefinitely
  // during a mistakenly enabled subscription.
  log.info("whatsapp_meta_webhook_ignored", {
    reason: "meta provider not yet implemented (phase B)",
  });
  return NextResponse.json({ ok: true });
}
