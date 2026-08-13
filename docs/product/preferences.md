---
title: Preferences — personal account settings
summary: Panduan mengatur tampilan, bahasa, saluran notifikasi, dan link ke Telegram / WhatsApp untuk akun personal Anda.
---

# Preferences

Halaman **Preferences** (`/settings/preferences`) adalah pusat kontrol
personal untuk setiap user. Tidak ada gate role — setiap user login
dapat mengubah preferensinya sendiri. Perubahan hanya berlaku untuk
akun Anda, tidak memengaruhi user lain di tenant.

Route: `src/app/(app)/settings/preferences/page.tsx`. Data disimpan di
tabel `user_notification_preferences`, `user_telegram_links`, dan
`user_whatsapp_links` — semuanya RLS-scoped ke `auth.uid()` Anda.

## Bagian yang tersedia

### 1. Tampilan (Appearance)

- **Tema**: Light / Dark / System (mengikuti setting OS). Toggle langsung — tidak perlu save.
- **Bahasa**: 🇮🇩 Bahasa Indonesia (default) / 🇬🇧 English. Persisted di cookie `NEXT_LOCALE` (TTL 1 tahun).

### 2. Preferensi notifikasi (Notification grid)

Grid 2D per kategori notifikasi × saluran:

| Kategori                       | Contoh                                                    |
| ------------------------------ | --------------------------------------------------------- |
| **Approvals**                  | Approval baru menunggu Anda; approve / reject dari orang lain |
| **Finance**                    | Petty cash refill; CA settlement due                      |
| **HR**                         | LEAVE / OVERTIME / SICK request state changes             |
| **Performance**                | Project reviewer notes request; evaluation state changes  |
| **Project & Issues**           | Milestone breach; issue escalation                        |
| **AI insights**                | Daily digest ready                                        |

Saluran yang tersedia:

- **Bell in-app** — selalu aktif (tidak bisa di-disable, badge di topbar).
- **Email** — dikirim ke email login Anda. Toggle per kategori.
- **Telegram** — perlu link (lihat di bawah).
- **WhatsApp** — perlu link (lihat di bawah).

**Rekomendasi**: matikan Email untuk kategori yang Anda cek harian
lewat aplikasi (mis. approvals kalau Anda role Finance / Approver).
Biarkan Email aktif untuk kategori yang jarang tapi penting (mis. SLA
breach, evaluation finalization).

### 3. Telegram bot (opsional)

Kalau tenant Anda sudah setup bot Telegram (lihat integrations →
[`../integrations/telegram-bot.md`](../integrations/telegram-bot.md)),
Anda bisa link akun personal Anda ke bot:

1. Klik **Link Telegram** — dapatkan deep-link ke Telegram.
2. Buka Telegram, klik link → bot akan mengirim konfirmasi ke aplikasi.
3. Card berubah menjadi **Linked** — notifikasi kategori yang Anda
   pilih di grid mulai dikirim ke chat pribadi Anda.

Kalau tenant belum setup bot, card menampilkan "Belum ada bot
Telegram di tenant ini" — hubungi Tenant Admin.

### 4. WhatsApp (opsional, via Fonnte)

Sama seperti Telegram tapi via Fonnte gateway (lihat
[`../integrations/whatsapp-fonnte.md`](../integrations/whatsapp-fonnte.md)).

1. Klik **Link WhatsApp** — dapatkan link ke WhatsApp Web dengan
   pesan template.
2. Kirim pesan → bot Fonnte tenant akan mem-verify + link akun Anda.
3. Card berubah menjadi **Linked**.

## Privasi & data

- Preferensi ini **personal** — admin lain tidak bisa melihat setting Anda (RLS di `user_notification_preferences`).
- Telegram / WhatsApp handle Anda **tidak dibagikan** ke user lain — hanya sistem yang membaca untuk mengirim notif.
- Anda dapat **unlink** kapan saja — pesan notifikasi berhenti seketika.
- Ganti password / email login di halaman [`/profile`](/profile), bukan di Preferences.

## Troubleshooting

**Q: Saya centang Email tapi tidak menerima email**  
A: Cek folder Spam dulu. Kalau tetap tidak ada, tanya Tenant Admin
apakah SMTP tenant sudah dikonfigurasi (default lokal = mailpit port
1025, di produksi = provider transactional seperti Resend / Postmark).

**Q: Telegram bot balasan pesan "Not linked" walau card Linked**  
A: Kemungkinan bot di-restart dan sesi Anda invalidated. Klik
**Unlink** di card lalu **Link Telegram** ulang.

**Q: Kalau saya ganti device / login di device lain?**  
A: Setting tersimpan per user (bukan per device), jadi login di
device baru langsung membawa setting yang sama. Tema mungkin awalnya
System kalau OS device baru berbeda, tapi klik toggle sekali sudah
sinkron.

## Related

- Bahasa untuk seluruh app → toggle di topbar (sama value dengan Preferences).
- Login credentials / password → [`/profile`](/profile).
- Bot / gateway configuration di sisi Admin → [`../integrations/README.md`](../integrations/README.md).
