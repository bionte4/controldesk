/**
 * Manual end-to-end test for the tenant Fonnte WhatsApp integration.
 *
 * What it does:
 *   1. Loads the tenant WhatsApp config from Postgres (via service-role client).
 *   2. Decrypts the stored device token in-memory.
 *   3. Calls Fonnte `/device` to verify the token is still valid + device
 *      status is `connect`.
 *   4. Calls the shared `sendWhatsAppMessage()` helper with the target
 *      number provided on the command line.
 *
 * Usage:
 *   pnpm test:wa +6281234567890
 *   pnpm test:wa +6281234567890 "Custom message body"
 *
 * The script bypasses Next.js RSC / Server Actions so we can exercise the
 * outbound path without a browser session. It uses the SAME encrypted
 * storage + adapter code the production path calls, so a success here
 * proves the whole outbound chain works.
 */

import {
  loadTenantWhatsAppConfig,
  type WhatsAppProvider,
} from "@/lib/integrations/whatsapp/repository";
import {
  sendWhatsAppMessage,
  verifyWhatsAppCredentials,
} from "@/lib/integrations/whatsapp/client";

// Demo tenant from `supabase/seed.sql` — override with `--tenant=<uuid>`.
const DEFAULT_TENANT_ID = "11111111-1111-1111-1111-111111111111";

function parseArgs(): {
  tenantId: string;
  target: string;
  body: string;
} {
  const argv = process.argv.slice(2);
  let tenantId = DEFAULT_TENANT_ID;
  const positional: string[] = [];
  for (const raw of argv) {
    if (raw.startsWith("--tenant=")) {
      tenantId = raw.slice("--tenant=".length);
    } else {
      positional.push(raw);
    }
  }
  const target = positional[0];
  if (!target) {
    console.error(
      "usage: pnpm test:wa <+E164 phone> [message] [--tenant=<uuid>]",
    );
    process.exit(2);
  }
  const body =
    positional.slice(1).join(" ") ||
    `ControlDesk Fonnte smoke test — ${new Date().toISOString()}`;
  return { tenantId, target, body };
}

function fmt(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

async function main() {
  const { tenantId, target, body } = parseArgs();

  console.log("=".repeat(64));
  console.log("ControlDesk WhatsApp (Fonnte) smoke test");
  console.log("=".repeat(64));
  console.log(`tenant  : ${tenantId}`);
  console.log(`target  : ${target}`);
  console.log(`body    : ${body}`);
  console.log("");

  // ---- Step 1: load config ------------------------------------------
  console.log("[1/3] Loading tenant WhatsApp config…");
  const cfg = await loadTenantWhatsAppConfig(tenantId);
  if (!cfg) {
    console.error(
      `  ✗ No config row for tenant ${tenantId}. Save one via /settings/integrations/whatsapp-business first.`,
    );
    process.exit(1);
  }
  const provider: WhatsAppProvider = cfg.provider;
  console.log(`  ✓ provider        : ${provider}`);
  console.log(`  ✓ phoneNumberId   : ${cfg.phoneNumberId}`);
  console.log(`  ✓ is_active       : ${cfg.isActive}`);
  console.log(`  ✓ last_error      : ${cfg.lastError ?? "(none)"}`);
  console.log(`  ✓ token length    : ${cfg.apiToken.length} chars`);
  if (!cfg.isActive) {
    console.error(
      "  ✗ Config exists but is_active=false — activate via UI first.",
    );
    process.exit(1);
  }
  if (provider !== "FONNTE") {
    console.error(
      `  ✗ This script is Fonnte-only. Current provider: ${provider}`,
    );
    process.exit(1);
  }
  console.log("");

  // ---- Step 2: verify device ---------------------------------------
  console.log("[2/3] Verifying device against Fonnte /device …");
  const verify = await verifyWhatsAppCredentials({
    provider: cfg.provider,
    phoneNumberId: cfg.phoneNumberId,
    apiToken: cfg.apiToken,
    accountSid: null,
  });
  if (!verify.ok) {
    console.error(`  ✗ Fonnte rejected token: [${verify.code}] ${verify.error}`);
    console.error("    Fixes:");
    console.error("      • Re-check the device token in Fonnte dashboard.");
    console.error("      • Ensure the device is paired (scan QR on phone).");
    console.error("      • If subscription expired, top up on fonnte.com.");
    process.exit(1);
  }
  console.log(`  ✓ device account  : ${verify.providerAccountName ?? "(unknown)"}`);
  console.log("");

  // ---- Step 3: send message ----------------------------------------
  console.log("[3/3] Sending WhatsApp message…");
  const send = await sendWhatsAppMessage({
    tenantId,
    waId: target,
    text: body,
  });
  console.log(fmt(send));
  if (!send.ok) {
    console.error(`  ✗ Send failed: [${send.code}] ${send.error}`);
    console.error("    Common causes:");
    console.error("      • Device offline (WhatsApp Web on phone logged out)");
    console.error("      • Target number not registered on WhatsApp");
    console.error("      • Fonnte quota exhausted");
    process.exit(1);
  }
  console.log(
    `  ✓ Sent! providerMessageId=${send.providerMessageId ?? "(none)"}`,
  );
  console.log("");
  console.log(
    "Cek HP tujuan sekarang — pesan seharusnya sudah masuk dalam ~5 detik.",
  );
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
