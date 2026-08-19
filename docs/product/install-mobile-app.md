---
title: Install ControlDesk di HP (PWA & APK)
summary: Panduan lengkap memasang ControlDesk sebagai aplikasi di Android, iOS, dan Desktop lewat PWA (langsung dari browser) atau APK TWA (Android, opsional). Termasuk setup notifikasi push dan troubleshooting.
---

# Install ControlDesk di HP

ControlDesk bisa dipasang seperti aplikasi native di HP / laptop Anda,
lengkap dengan **icon home screen, notifikasi push, dan tampilan full-
screen** (tanpa URL bar browser). Ada dua cara memasangnya:

| Metode | Platform | Butuh install file? | Notifikasi push | Recommended |
|---|---|---|---|---|
| **PWA** (Progressive Web App) | Android, iOS, Desktop | ❌ Tidak — 2 tap dari browser | ✅ Android + Desktop; ⚠️ iOS 16.4+ | ✅ untuk semua user |
| **APK TWA** (Trusted Web Activity) | Android saja | ✅ Ya, download APK ~4 MB | ✅ | Opsional — untuk device yang tidak bisa install PWA |

**TL;DR** — pakai **PWA** kalau HP Anda Android atau iOS versi terbaru.
Pakai **APK TWA** hanya kalau tombol "Install ke HP" tidak muncul di
Chrome Android Anda (browser custom / launcher tertentu memblokir PWA).

## Prasyarat

- **Login** ke tenant Anda dulu (mis. `https://itps.controldesk.site`)
  — install button hanya muncul di halaman internal, bukan di halaman
  marketing.
- **Browser modern**:
  - Android: Chrome 90+, Edge, Samsung Internet, Brave.
  - iOS: Safari 16.4+ (untuk push notif; PWA install jalan di Safari
    versi lebih lama tapi tanpa push).
  - Desktop: Chrome / Edge / Brave (Windows, macOS, Linux). Safari macOS
    14+ juga support tapi tanpa push notif.
- **Koneksi HTTPS** — install button tidak akan muncul di `http://`
  (browser policy).

---

## Cara 1 — Install PWA (recommended)

### Android (Chrome)

**Langkah cepat**:

1. Buka `https://<tenant>.controldesk.site` di Chrome (mis.
   `https://itps.controldesk.site`).
2. Login seperti biasa.
3. Di **sidebar kiri paling bawah**, tap tombol **"Install ke HP"**
   (ikon smartphone).
4. Chrome menampilkan popup — tap **"Install"** / **"Tambahkan"**.
5. Icon ControlDesk muncul di home screen HP Anda.
6. Tap icon → app terbuka full-screen, tanpa URL bar.

**Kalau tombol "Install ke HP" tidak muncul** di sidebar (jarang
terjadi):

- Tap **titik tiga (⋮)** di kanan atas Chrome.
- Pilih **"Add to Home screen"** / **"Install app"**.
- Confirm.

Kalau menu itu juga tidak ada, browser Anda kemungkinan belum support
PWA (biasanya browser custom bawaan HP). Solusi: install Chrome dari
Play Store, atau pakai [APK TWA](#cara-2--install-apk-twa-android-only) di bawah.

### iOS (Safari)

**Penting** — di iOS, PWA hanya bisa di-install lewat **Safari** (bukan
Chrome / Firefox — di iOS mereka semua pakai engine Safari, tapi menu
install-nya hanya di Safari asli).

1. Buka `https://<tenant>.controldesk.site` di **Safari**.
2. Login.
3. Tap tombol **Share** (📤 kotak dengan panah ke atas) di bawah.
4. Scroll → pilih **"Add to Home Screen"**.
5. Beri nama (default "ControlDesk") → tap **Add**.
6. Icon muncul di home screen.

**Batasan iOS**:

- Push notifikasi hanya jalan di **iOS 16.4 ke atas** (Maret 2023+).
  Kalau iPhone Anda lebih lama, PWA jalan penuh tapi push notif tidak
  masuk — Anda tetap dapat notifikasi via email / Telegram / WhatsApp
  (atur di `/settings/preferences`).
- Setelah install, buka app dari icon home screen minimal 1x untuk
  mengaktifkan push subscription (di halaman `/settings/preferences`
  → tap "Aktifkan notifikasi").

### Desktop (Chrome / Edge / Brave)

1. Buka `https://<tenant>.controldesk.site` di Chrome / Edge / Brave.
2. Login.
3. Di **address bar sebelah kanan**, klik ikon **"Install ControlDesk"**
   (ikon monitor kecil dengan panah download, muncul otomatis kalau app
   installable).
4. Klik **"Install"**.
5. App terbuka di window terpisah + shortcut muncul di Start Menu
   (Windows) / Applications folder (macOS) / app grid (Linux).

Alternatif: tap tombol **"Install ke HP"** di sidebar bawah — sama
efeknya.

### Uninstall

- **Android / iOS**: long-press icon home screen → tap "Uninstall" /
  "Remove App".
- **Desktop**: buka app → **titik tiga (⋮)** di kanan atas window →
  "Uninstall ControlDesk".

Uninstall menghapus icon + cache lokal, tapi **tidak** menghapus akun
Anda. Login masih valid, data server tetap aman.

---

## Cara 2 — Install APK TWA (Android only)

TWA (Trusted Web Activity) adalah APK Android **~4 MB** yang membungkus
PWA jadi aplikasi native. Berguna kalau:

- Chrome PWA install tidak jalan di HP Anda (browser custom, launcher
  tertentu).
- Anda mau icon terpisah untuk beberapa tenant di HP yang sama (mis.
  admin yang handle 3 tenant sekaligus — 3 icon terpisah).
- Distribusi ke user via manual sideload lebih convenient daripada
  menyuruh mereka buka Chrome tiap kali.

**Perbedaan dengan PWA** — praktis tidak ada. TWA jalan di Chrome
engine yang sama, punya subscription push yang sama, akses data
identik. Bedanya cuma cara instal + icon-nya "native app" di Settings.

### Download

APK dibangun oleh admin tenant Anda (via `pnpm twa:build <tenant>` —
lihat [`deploy/twa/README.md`](https://github.com/bontiharyanto/controldesk/blob/main/deploy/twa/README.md)).
Minta link download dari IT / admin tenant Anda.

**Nama file** yang dikirim: `controldesk-<tenant>-signed.apk`  
**Ukuran**: ~4-5 MB

### Install di HP Android

1. **Aktifkan "Install unknown apps"** untuk file manager Anda:
   Settings → **Apps** → **Special access** → **Install unknown apps**
   → pilih file manager (mis. "Files" / "My Files") → toggle **"Allow
   from this source"** ke ON.
2. Buka file manager → tap file `.apk` yang Anda download.
3. Tap **"Install"** → tunggu ~5 detik → tap **"Open"**.
4. App langsung terbuka full-screen. Icon muncul di app drawer +
   home screen (kalau launcher Anda auto-add).

### Cek instalasi berjalan benar

Buka app dari icon. Di layar utama:

- ✅ **Tidak ada URL bar / tombol back Chrome di atas** — TWA
  ter-verifikasi.
- ⚠️ **Ada URL bar dengan nama domain** — TWA tidak ter-verifikasi
  (biasanya fingerprint di server tidak match dengan APK). Report ke
  admin tenant.

### Update APK

TWA tidak auto-update seperti Play Store. Kalau ada versi baru:

- Admin tenant kirim APK versi baru.
- Anda install lagi (di atas versi lama — data tidak hilang selama
  package name sama).
- App auto-restart ke versi baru.

Update **konten** app (dashboard, form, dsb) tetap otomatis — TWA baca
web view real-time, jadi kalau server sudah update, app sudah update
juga.

### Uninstall

Settings → **Apps** → **ControlDesk <tenant>** → **Uninstall**.
Atau long-press icon home screen → **"Uninstall"**.

---

## Setup notifikasi push (setelah install)

Ini bagian penting — **install app saja tidak otomatis aktifkan push**.
Push adalah opt-in per-device.

1. Buka app (dari icon home screen, bukan browser tab).
2. Buka menu: **Settings → Preferences** (atau langsung
   `/settings/preferences`).
3. Scroll ke section **"Notifikasi push (HP)"**.
4. Tap tombol **"Aktifkan notifikasi"**.
5. HP menampilkan izin OS: tap **"Allow"** / **"Izinkan"**.
6. Setelah muncul badge hijau **"Aktif"**, notifikasi push sudah jalan.

### Cek push notif betul-betul jalan

Test cara termudah: minta rekan approver kirim approval ke Anda, atau
minta HR trigger notifikasi apapun. Push should arrive dalam <5 detik.

Kalau tidak masuk:

- Cek `/settings/preferences` → matrix di atas: pastikan kolom **"Push
  (HP)"** untuk kategori yang bersangkutan **ON** (default: ON untuk
  Approvals + SLA).
- Cek permission OS: Android Settings → Apps → ControlDesk →
  Notifications → **Allow**. iOS Settings → ControlDesk →
  Notifications → **Allow**.
- Cek battery optimization: Android kadang mem-block background push
  untuk app yang jarang dibuka. Kalau perlu, whitelist app di
  Settings → **Battery** → **Battery optimization** → cari
  ControlDesk → **Don't optimize**.

### Nonaktifkan push per-device

Di `/settings/preferences` → **"Notifikasi push (HP)"** → tap **"Matikan
notifikasi"**. Berlaku hanya untuk device ini — kalau Anda install app
di HP lain, push di HP lain tetap aktif.

Kalau mau nonaktif per-kategori (mis. tetap terima Approvals tapi mute
SLA warning), edit matrix di atas — uncheck kolom "Push (HP)" untuk
baris yang tidak diinginkan. **Tidak perlu** uninstall app.

---

## Multi-tenant di HP yang sama

Kalau Anda punya akses ke lebih dari satu tenant (mis. admin yang
handle 3 client), Anda bisa install app **per tenant** — icon terpisah
di home screen.

**Cara**:

- **PWA**: buka setiap subdomain di browser (`itps.controldesk.site`,
  `demo.controldesk.site`, dst.), install masing-masing. Chrome
  memperlakukan tiap subdomain sebagai PWA berbeda.
- **APK TWA**: minta APK per-tenant dari admin (`controldesk-itps.apk`,
  `controldesk-demo.apk`, dst.). Setiap APK punya package name unik,
  bisa co-existed.

Notifikasi push jalan **independen** per install — tidak ada crosstalk
antar tenant.

---

## Troubleshooting

**Q: Tombol "Install ke HP" tidak muncul di sidebar.**

A: Beberapa penyebab umum:

- **Anda pakai HTTP**, bukan HTTPS. Install button policy Chrome
  butuh HTTPS.
- **Anda sudah install** — button auto-hide setelah install sukses.
- **Browser Anda tidak support PWA** (browser custom bawaan HP).
  Pakai Chrome dari Play Store, atau pakai APK TWA.
- **Manifest gagal load** — hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).

**Q: App terbuka dengan URL bar / tombol back Chrome (bukan full-screen).**

A: Untuk PWA — biasanya install-nya tidak lengkap. Uninstall dari
home screen, hard-refresh browser, install ulang.

Untuk TWA APK — server fingerprint tidak match dengan APK signature.
Ini isu admin tenant, bukan Anda. Report ke IT.

**Q: Icon PWA burem / low-res di home screen.**

A: Chrome kadang caching versi icon lama. Uninstall + hard-refresh
browser + install ulang. Kalau masih burem, report ke IT — icon
sumber kemungkinan kurang resolusi.

**Q: Push notif tidak masuk padahal permission sudah ON.**

A: Cek berurutan:

1. `/settings/preferences` → matrix **"Push (HP)"** kategori
   bersangkutan ON.
2. OS notification permission ON (Settings → Apps → ControlDesk).
3. Battery optimization tidak block (Android): Settings → Battery →
   Battery optimization → ControlDesk → **Don't optimize**.
4. Focus mode / DND mode tidak sedang aktif.
5. Coba **matikan** dan **aktifkan lagi** notifikasi di
   `/settings/preferences` — kadang subscription token expired dan
   perlu refresh.

**Q: App offline — apa bisa dipakai?**

A: Sebagian. Screen yang **pernah dibuka** ter-cache dan bisa dilihat
offline (dashboard, list, form). Tapi **submit / approve tidak bisa
tanpa koneksi** — pending action akan gagal. Sync otomatis begitu
koneksi kembali.

**Q: App restart tiap saya buka. Data tidak persist.**

A: HP Anda kemungkinan low-memory dan Android kill background
process. Solusi:

- Aktifkan **"Keep in background"** di Settings → Apps → ControlDesk.
- Restart HP kalau memory penuh.
- Pertimbangkan APK TWA — TWA lebih aman dari Android's memory
  killer daripada PWA di Chrome tab.

**Q: Saya install PWA di iPhone tapi push notif tidak muncul.**

A: Cek versi iOS Anda: Settings → General → About → **Software
Version**. Push PWA hanya jalan di **iOS 16.4+** (Maret 2023). Kalau
lebih lama, upgrade OS atau pakai channel alternatif (email,
Telegram, WhatsApp — atur di `/settings/preferences`).

---

## Related

- [Preferences — personal account settings](/help/preferences) —
  atur matrix notifikasi + link Telegram / WhatsApp.
- [End-to-end walkthrough](/help/end-to-end-walkthrough) — tutorial
  lengkap pakai ControlDesk dari login sampai settle expense.
- [Roles & permissions](/help/roles-and-permissions) — siapa dapat
  notifikasi apa berdasarkan role Anda.
