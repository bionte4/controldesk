/**
 * Dumps the raw Fonnte `/device` response for the currently configured
 * tenant. Useful when messages are accepted (`status:true`) at send
 * time but never land on the recipient's phone — the device may be
 * paired but the WhatsApp Web session on the phone is dead.
 *
 * Usage:
 *   pnpm fonnte:device
 *   pnpm fonnte:device --tenant=<uuid>
 */

import { loadTenantWhatsAppConfig } from "@/lib/integrations/whatsapp/repository";

const DEFAULT_TENANT_ID = "11111111-1111-1111-1111-111111111111";

function parseArgs(): { tenantId: string } {
  let tenantId = DEFAULT_TENANT_ID;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--tenant=")) {
      tenantId = raw.slice("--tenant=".length);
    }
  }
  return { tenantId };
}

async function main() {
  const { tenantId } = parseArgs();
  const cfg = await loadTenantWhatsAppConfig(tenantId);
  if (!cfg) {
    console.error(`No WhatsApp config for tenant ${tenantId}`);
    process.exit(1);
  }
  if (cfg.provider !== "FONNTE") {
    console.error(`Provider is ${cfg.provider}, not FONNTE.`);
    process.exit(1);
  }

  console.log(`tenant           : ${tenantId}`);
  console.log(`phoneNumberId    : ${cfg.phoneNumberId}`);
  console.log(`is_active (db)   : ${cfg.isActive}`);
  console.log(`token length     : ${cfg.apiToken.length}`);
  console.log("");
  console.log("POST https://api.fonnte.com/device");
  console.log("");

  const res = await fetch("https://api.fonnte.com/device", {
    method: "POST",
    headers: {
      Authorization: cfg.apiToken,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  const text = await res.text();
  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log("");
  console.log("Response body:");
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
