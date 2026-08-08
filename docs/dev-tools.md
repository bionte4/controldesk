# Developer CLI Tools

Kumpulan tools command-line untuk verifikasi integrasi eksternal +
debugging. Semua tool run di **luar** Next.js runtime (via `tsx`)
supaya bisa dipanggil dari terminal tanpa boot server dev.

## Cara kerja umum

Semua tool ini di-load lewat pattern yang sama:

```
node --env-file=.env.local
  ./node_modules/tsx/dist/cli.mjs
  --tsconfig scripts/tsconfig.json
  scripts/<name>.ts
```

- **`--env-file=.env.local`** — Node native env loader (Node 20+).
  Membaca `.env.local` dari root repo. `.env` juga dibaca kalau ada.
- **`tsx`** — TypeScript runtime tanpa build step.
- **`scripts/tsconfig.json`** — path alias khusus:
  - `@/*` → `src/*` (sama dengan Next.js).
  - `server-only` → `scripts/server-only-stub.ts` (stub kosong supaya
    modul internal `src/lib/integrations/*` yang import `server-only`
    tidak throw di luar Next.js runtime).
- **Service-role DB access** — script pakai `SUPABASE_SERVICE_ROLE_KEY`,
  jadi bypass RLS. **Hanya jalankan di dev / trusted admin machine**.

## Katalog tool

| Script                                                               | Command             | Purpose                                                                        |
| -------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| [`scripts/test-ai-insight.ts`](../scripts/test-ai-insight.ts)        | `pnpm test:ai`      | Verifikasi provider AI (Gemini/OpenAI/Anthropic) end-to-end.                   |
| [`scripts/test-telegram.ts`](../scripts/test-telegram.ts)            | `pnpm test:tg`      | Verifikasi bot Telegram tenant + list pending chats + kirim test.              |
| [`scripts/test-whatsapp-fonnte.ts`](../scripts/test-whatsapp-fonnte.ts) | `pnpm test:wa`      | Verifikasi device Fonnte + kirim test message ke nomor manapun.                |
| [`scripts/fonnte-device-status.ts`](../scripts/fonnte-device-status.ts) | `pnpm fonnte:device` | Raw dump Fonnte `/device` API — untuk debug kalau pesan tidak sampai.          |

## `pnpm test:ai` — AI Insights smoke test

**Detail integrasi**: [`integrations/ai-insights-gemini.md`](integrations/ai-insights-gemini.md).

### Sintaks

```bash
pnpm test:ai [--locale=id|en] [prompt string]
```

### Contoh

```bash
# Default: bahasa Inggris, prompt bawaan
pnpm test:ai

# Force Bahasa Indonesia
pnpm test:ai --locale=id

# Prompt custom (English)
pnpm test:ai "Analyze cashflow risk over the next 30 days"

# Prompt custom (Bahasa Indonesia)
pnpm test:ai --locale=id "Analisa risiko cashflow 30 hari ke depan"
```

### Yang dilakukan script

1. Baca `AI_PROVIDER`, `AI_MODEL_ID`, dan API key dari `.env.local`.
2. Kalau `AI_PROVIDER=mock` → exit dengan pesan "Set provider first".
3. Kalau API key belum di-set / masih `PASTE_...` → exit dengan URL untuk get key.
4. Dynamic-import package provider (`@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`). Kalau package belum install → exit dengan command `pnpm add ...`.
5. Panggil `generateObject()` dengan Zod schema:
   ```typescript
   z.object({
     strength: z.string().min(3),
     risk:     z.string().min(3),
     action:   z.string().min(3),
   })
   ```
6. Print hasil JSON, tokens usage, dan latency.

### Interpretasi output

**Sukses** — exit code 0:

```
Result:
{
  "strength": "…",
  "risk": "…",
  "action": "…"
}

tokens in : 58
tokens out: 702
latency   : 4868ms

SUKSES — AI Insights sekarang bisa dijalankan live di /insights.
```

**Gagal — API key**:
```
GAGAL:
[AI_API_CALL_ERROR] API key not valid...
  → API key salah atau tidak valid. Cek di .env.local.
```

**Gagal — rate limit**:
```
GAGAL:
[AI_RetryError] 429 Resource Exhausted...
  → Rate limit hit. Free tier: 10 req/min. Tunggu 60 detik.
```

**Gagal — model tidak tersedia**:
```
GAGAL:
[AI_APICallError] This model models/gemini-2.5-flash is no longer available to new users.
  → Model `gemini-2.5-flash` mungkin tidak tersedia. Coba gemini-2.0-flash atau gemini-1.5-flash.
```

## `pnpm test:tg` — Telegram smoke test

**Detail integrasi**: [`integrations/telegram-bot.md`](integrations/telegram-bot.md).

### Sintaks

```bash
pnpm test:tg [chat_id] [message] [--tenant=<uuid>]
```

### Contoh

```bash
# Verify config + list pending chats (user yang sudah /start ke bot)
pnpm test:tg

# Kirim test message default
pnpm test:tg 894167675

# Kirim custom HTML message (bold, italic, link supported)
pnpm test:tg 894167675 "<b>Halo</b> dari <i>ControlDesk</i>"

# Test tenant lain (bukan demo default)
pnpm test:tg 894167675 --tenant=22222222-...
```

### Yang dilakukan script

1. Load config bot dari `tenant_telegram_bots` untuk tenant (default: `11111111-…`).
2. Cek `is_active=true`, kalau tidak → exit.
3. Panggil Telegram `GET /getMe` untuk verifikasi token masih valid.
4. Kalau tidak ada `chat_id` arg → panggil `GET /getUpdates` → list semua chat yang pernah interaksi.
5. Kalau ada `chat_id` → panggil `sendMessage()` real via helper produksi (`sendTelegramMessage`).
6. Print message id + link "cek Telegram Anda".

### Cara pertama kali cari `chat_id` sendiri

1. Buka Telegram → search `@<bot_username_Anda>`.
2. Kirim `/start` ke bot.
3. Jalankan `pnpm test:tg` (tanpa arg).
4. Table output akan menampilkan `chat_id` Anda.
5. Copy, lalu:
   ```bash
   pnpm test:tg <chat_id_tadi>
   ```
6. Pesan test masuk di Telegram Anda dalam ~2 detik.

### Interpretasi output

**Sukses**:
```
[3/3] Sending message to chat 894167675 …
{
  "ok": true,
  "providerMessageId": 2
}
  ✓ Sent! providerMessageId=2
```

**Gagal — token invalid**:
```
[2/3] Verifying bot against Telegram /getMe …
  ✗ Telegram rejected token: [TELEGRAM_ERROR] Unauthorized
    Fixes:
      • Re-check the token via @BotFather (/token).
      • Delete + re-add via /settings/integrations/telegram-bot.
```

**Gagal — chat not found**:
```
[3/3] Sending message to chat 999999 …
{
  "ok": false,
  "code": "TELEGRAM_ERROR",
  "error": "Bad Request: chat not found"
}
```
Berarti chat_id salah, atau user belum kirim `/start` ke bot.

## `pnpm test:wa` — WhatsApp (Fonnte) smoke test

**Detail integrasi**: [`integrations/whatsapp-fonnte.md`](integrations/whatsapp-fonnte.md).

### Sintaks

```bash
pnpm test:wa "<nomor>" ["message"] [--tenant=<uuid>]
```

### Contoh

```bash
# Nomor dengan +62 (E.164)
pnpm test:wa "+6288234567890"

# Nomor dengan 0-prefix (auto-normalized ke 62)
pnpm test:wa "088234567890"

# Custom body
pnpm test:wa "088234567890" "Halo dari ControlDesk"

# Test tenant lain
pnpm test:wa "+62..." --tenant=22222222-...
```

### Yang dilakukan script

1. Load config WhatsApp dari `tenant_whatsapp_configs`.
2. Verifikasi provider = `FONNTE` (Twilio/Meta belum wired).
3. Panggil Fonnte `GET /device` untuk cek token + device status.
4. Kalau device `disconnect` → warn tapi tetap coba send.
5. Panggil `sendWhatsAppMessage()` yang otomatis normalize nomor dan
   route ke adapter Fonnte.
6. Print `providerMessageId` + `cost_credits`.

### Interpretasi output

**Sukses tapi pesan tidak sampai**:
Kemungkinan penyebab (urut dari paling sering):

1. **Nomor target = nomor device** — Fonnte accept, WhatsApp drop. Test dengan nomor lain.
2. **WA Web session di HP mati** — cek `pnpm fonnte:device`. Kalau `status:false, reason: Device not connected`, buka Fonnte dashboard → reconnect QR.
3. **Nomor target belum pernah aktif di WhatsApp** — WhatsApp drop silently.
4. **Quota habis** — free tier 1,000/bulan.

**Gagal — invalid token**:
```
[2/3] Verifying device with Fonnte /device …
  ✗ Fonnte rejected token: Invalid token
```

## `pnpm fonnte:device` — raw Fonnte device dump

**Detail integrasi**: [`integrations/whatsapp-fonnte.md`](integrations/whatsapp-fonnte.md#security--compliance).

### Sintaks

```bash
pnpm fonnte:device [--tenant=<uuid>]
```

### Yang dilakukan script

1. Load config WhatsApp untuk tenant.
2. Decrypt device token.
3. Panggil Fonnte `GET https://api.fonnte.com/device` dengan `Authorization: <token>` (tanpa `Bearer`).
4. Print raw JSON response.

### Interpretasi output

**Device online + healthy**:
```json
{
  "status": true,
  "device": "6289633000000",
  "quota": 998,
  "expired": "2029-08-08 22:32:00",
  "package": "Personal",
  "autoread": "yes"
}
```

**Device offline** (WA Web session mati di HP):
```json
{
  "status": false,
  "reason": "Device not connected"
}
```

**Token invalid**:
```json
{
  "status": false,
  "reason": "Invalid token"
}
```

## Menambah tool baru

Kalau Anda perlu tool CLI baru (mis. dump `/insights` untuk satu tenant,
atau clear Redis cost cap manual):

### Langkah 1 — Buat script

`scripts/<name>.ts`:

```typescript
/**
 * Deskripsi singkat.
 *
 * Usage:
 *   pnpm <name>
 */

import { loadSomething } from "@/lib/xxx";

async function main() {
  console.log("...");
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
```

### Langkah 2 — Tambah script di `package.json`

```json
{
  "scripts": {
    "myscript": "node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs --tsconfig scripts/tsconfig.json scripts/myscript.ts"
  }
}
```

### Langkah 3 — Kalau butuh `server-only` bypass

Semua module di `src/lib/integrations/**/repository.ts` import `server-only`
untuk gate webpack. Di runtime `tsx`, gate ini akan throw. Path alias di
`scripts/tsconfig.json` sudah handle ini:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["../src/*"],
      "server-only": ["./server-only-stub.ts"]
    }
  }
}
```

Kalau Anda ingin `server-only` benar-benar strict di runtime (misal
production build), path alias ini **HANYA aktif via `scripts/tsconfig.json`**,
tidak affect `tsconfig.json` root Next.js.

### Langkah 4 — Update dokumentasi

Tambah row di [Katalog tool](#katalog-tool) + section detail seperti
di atas. Update `.env.local.example` kalau ada env var baru.

## Kenapa pakai `tsx` bukan `ts-node`?

- `tsx` ~40% lebih cepat startup dari `ts-node`.
- `tsx` support ESM native (Node 20+).
- `ts-node` masih butuh workaround untuk `--env-file` + ESM.
- `tsx` sudah bundled sebagai devDependency.

## Kenapa `node --env-file` bukan `dotenv`?

- Native Node 20+ — no dependency.
- Parser konsisten dengan Vercel/Next.js env loading.
- Gagal-cepat kalau file tidak ada.

## Cross-references

- Setup masing-masing integrasi → [`integrations/README.md`](integrations/README.md)
- Environment vars → [`env-reference.md`](env-reference.md)
- Testing strategy → [`testing.md`](testing.md)
- QA smoke → [`qa/manual-smoke-scripts.md`](qa/manual-smoke-scripts.md)
