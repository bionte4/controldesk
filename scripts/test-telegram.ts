/**
 * Manual end-to-end test for the tenant Telegram bot integration.
 *
 * What it does:
 *   1. Loads the tenant bot config from Postgres (via service-role client).
 *   2. Decrypts the stored bot token in-memory.
 *   3. Calls Telegram `getMe` to verify the token is still valid and the
 *      bot is reachable.
 *   4. If no chat_id was provided, calls `getUpdates` to list any pending
 *      chats (i.e. users who already `/start`ed the bot). This is the
 *      easiest way to discover a chat_id for the very first test.
 *   5. If a chat_id was provided, calls `sendMessage` and prints the
 *      resulting `message_id`.
 *
 * Usage:
 *   pnpm test:tg                                # verify + list pending chats
 *   pnpm test:tg <chat_id>                      # send default test message
 *   pnpm test:tg <chat_id> "Custom body"        # send custom message
 *   pnpm test:tg <chat_id> --tenant=<uuid>      # override tenant
 *
 * To get a chat_id:
 *   1. On Telegram, search @controlDESK_bot (or your bot's @handle).
 *   2. Send `/start` to the bot.
 *   3. Run `pnpm test:tg` (no args) — the script lists your chat_id.
 *   4. Copy it and run `pnpm test:tg <that_id>`.
 */

import {
  loadTenantBotConfig,
} from "@/lib/integrations/telegram/repository";
import {
  sendTelegramMessage,
  verifyTelegramBotToken,
} from "@/lib/integrations/telegram/client";

const DEFAULT_TENANT_ID = "11111111-1111-1111-1111-111111111111";

function parseArgs(): {
  tenantId: string;
  chatId: string | null;
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
  const chatId = positional[0] ?? null;
  const body =
    positional.slice(1).join(" ") ||
    `<b>ControlDesk Telegram smoke test</b>\n${new Date().toISOString()}`;
  return { tenantId, chatId, body };
}

async function listPendingChats(botToken: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/getUpdates?limit=20`,
    { method: "GET" },
  );
  const parsed = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: Array<{
      message?: {
        chat?: {
          id?: number;
          type?: string;
          title?: string;
          first_name?: string;
          last_name?: string;
          username?: string;
        };
        text?: string;
        date?: number;
      };
    }>;
  };
  if (!parsed.ok || !parsed.result) return [];
  const seen = new Map<
    number,
    {
      chat_id: number;
      display: string;
      last_text: string;
      last_at: string;
    }
  >();
  for (const upd of parsed.result) {
    const c = upd.message?.chat;
    if (!c || typeof c.id !== "number") continue;
    seen.set(c.id, {
      chat_id: c.id,
      display:
        c.title ??
        [c.first_name, c.last_name].filter(Boolean).join(" ") ??
        c.username ??
        "(unknown)",
      last_text: upd.message?.text ?? "(non-text)",
      last_at: upd.message?.date
        ? new Date(upd.message.date * 1000).toISOString()
        : "(no ts)",
    });
  }
  return Array.from(seen.values());
}

async function main() {
  const { tenantId, chatId, body } = parseArgs();

  console.log("=".repeat(64));
  console.log("ControlDesk Telegram smoke test");
  console.log("=".repeat(64));
  console.log(`tenant : ${tenantId}`);
  console.log(`chatId : ${chatId ?? "(not provided — will list pending chats)"}`);
  console.log("");

  // ---- Step 1: load config ------------------------------------------
  console.log("[1/3] Loading tenant Telegram bot config…");
  const cfg = await loadTenantBotConfig(tenantId);
  if (!cfg) {
    console.error(
      `  ✗ No config row for tenant ${tenantId}. Save one via /settings/integrations/telegram-bot first.`,
    );
    process.exit(1);
  }
  console.log(`  ✓ botUsername    : @${cfg.botUsername}`);
  console.log(`  ✓ is_active      : ${cfg.isActive}`);
  console.log(`  ✓ last_error     : ${cfg.lastError ?? "(none)"}`);
  console.log(`  ✓ token length   : ${cfg.botToken.length} chars`);
  if (!cfg.isActive) {
    console.error(
      "  ✗ Config exists but is_active=false — reactivate via UI first.",
    );
    process.exit(1);
  }
  console.log("");

  // ---- Step 2: verify bot -------------------------------------------
  console.log("[2/3] Verifying bot against Telegram /getMe …");
  const verify = await verifyTelegramBotToken(cfg.botToken);
  if (!verify.ok) {
    console.error(`  ✗ Telegram rejected token: [${verify.code}] ${verify.error}`);
    console.error("    Fixes:");
    console.error("      • Re-check the token via @BotFather (/token).");
    console.error("      • Delete + re-add via /settings/integrations/telegram-bot.");
    process.exit(1);
  }
  console.log(`  ✓ bot id         : ${verify.botId}`);
  console.log(`  ✓ bot username   : @${verify.botUsername}`);
  if (verify.botUsername.toLowerCase() !== cfg.botUsername.toLowerCase()) {
    console.warn(
      `  ⚠ DB username (@${cfg.botUsername}) differs from Telegram (@${verify.botUsername}).`,
    );
  }
  console.log("");

  // ---- Step 3: send OR discover chat ids ---------------------------
  if (!chatId) {
    console.log(
      "[3/3] No chat_id provided — listing pending chats via getUpdates …",
    );
    const chats = await listPendingChats(cfg.botToken);
    if (chats.length === 0) {
      console.log("  (empty)");
      console.log("");
      console.log(
        `Cara pakai: buka Telegram → cari @${verify.botUsername} → kirim /start`,
      );
      console.log("Setelah kirim /start, jalankan `pnpm test:tg` lagi.");
      console.log("Chat_id akan muncul di sini, lalu kirim pesan dengan:");
      console.log("  pnpm test:tg <chat_id>");
      return;
    }
    console.log("");
    console.log("Chat yang pernah interaksi dengan bot:");
    console.table(chats);
    console.log("");
    console.log("Kirim pesan test ke salah satunya:");
    console.log(`  pnpm test:tg ${chats[0]!.chat_id}`);
    return;
  }

  console.log(`[3/3] Sending message to chat ${chatId} …`);
  const send = await sendTelegramMessage({
    tenantId,
    chatId,
    text: body,
  });
  console.log(JSON.stringify(send, null, 2));
  if (!send.ok) {
    console.error(`  ✗ Send failed: [${send.code}] ${send.error}`);
    console.error("    Common causes:");
    console.error(
      "      • chat_id salah (angka bukan nama). Cek dengan `pnpm test:tg`.",
    );
    console.error(
      "      • User belum kirim /start ke bot (Telegram wajib inbound dulu).",
    );
    console.error("      • Bot di-block oleh user.");
    process.exit(1);
  }
  console.log(
    `  ✓ Sent! providerMessageId=${send.providerMessageId ?? "(none)"}`,
  );
  console.log("");
  console.log(
    "Cek Telegram — pesan seharusnya sudah masuk di chat dalam ~2 detik.",
  );
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
