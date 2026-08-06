# User guide — Client Portal (external clients)

Panduan untuk Anda sebagai **klien eksternal** yang login ke portal
ControlDesk untuk melihat progress proyek Anda.

Kalau Anda **staff internal** perusahaan yang menggunakan ControlDesk,
gunakan [`internal-users.md`](internal-users.md).

## First login

1. Anda akan menerima email dari vendor Anda berisi:
   - **URL portal**: biasanya `https://{vendor}.controldesk.app/portal/login`.
   - **Email login**: email yang Anda daftarkan.
   - **Temporary password**: password sekali pakai — akan diminta ganti saat login pertama.
2. Klik URL → halaman login.
3. Isi email + temporary password → **Sign in**.
4. Anda akan diredirect ke **halaman ganti password**. Ini wajib.

### Ganti password

Rules password (minimum):

- 10 karakter atau lebih.
- Minimal 1 huruf.
- Minimal 1 angka.
- Beda dari password sekarang.

Setelah berhasil ganti → Anda dibawa ke **dashboard portal**.

**Simpan password Anda dengan aman** — sistem tidak akan menampilkan
temporary password lagi. Kalau lupa, minta admin vendor untuk reset.

## Dashboard

`/portal` — halaman utama setelah login.

Yang Anda lihat:

- **Daftar proyek aktif** untuk perusahaan Anda.
- **Progress bar** per proyek (persentase penyelesaian).
- **Latest notifications** — event terbaru dari vendor (milestone selesai, project completed, dll).

## Detail proyek

Klik salah satu proyek di dashboard → `/portal/projects/[id]`.

### Section: Summary

- **Project name & code**.
- **Progress %** — angka bulat 0–100.
- **Start date & end date** — kalender rencana.
- **Contract type** — One-off / Retainer / Managed Services.
- **Status** — Planned / Active / Completed / Cancelled.

### Section: Milestone timeline

Daftar milestone (target pencapaian) dengan:

- **Milestone name & description**.
- **Due date**.
- **Status pill**: color-coded.
  - `PLANNED` — abu-abu, belum mulai.
  - `IN_PROGRESS` — biru, sedang dikerjakan.
  - `DONE` — hijau, selesai. ✓
  - `AT_RISK` — kuning, ada risiko delay.
  - `CANCELLED` — merah, dihapus dari scope.

### Section: Financials

Ringkasan finansial proyek — **hanya high-level**, tidak expose detail
transaksi internal:

- **Budget total** (bila di-share vendor).
- **Utilization %** — porsi budget yang sudah terpakai.
- **Related BPO contracts** — kontrak yang overlap dengan proyek ini
  (MRR bulanan, term start–end, status).

Anda **tidak** melihat individual expense internal, cash advance
karyawan, atau petty cash. Semua data itu operasional vendor dan tidak
di-share.

## Notifications

### Bell icon

Di kanan atas ada **bell icon** dengan angka unread. Klik → dropdown
menampilkan 5 notifikasi terbaru + link "See all".

Bell **auto-refresh** setiap 45 detik saat tab Anda aktif — jadi
notifikasi baru muncul tanpa Anda refresh page.

### Notification kinds

- **Milestone DONE** — vendor menyelesaikan milestone. ✓
- **Milestone AT RISK** — vendor flag potensi delay.
- **Milestone CANCELLED** — milestone dihapus dari scope.
- **Project COMPLETED** — seluruh proyek selesai.
- **System** — pesan generic dari vendor.

### Notifications page

`/portal/notifications` — full feed.

- List chronological, terbaru di atas.
- Unread bold + dot indicator.
- Klik notifikasi → deep link ke detail terkait (biasanya project detail).
- **Mark as read** per item, atau **Mark all as read** bulk.

## Multi-project view

`/portal/projects` — kalau vendor kerjakan multiple proyek untuk Anda,
semua tampil di sini.

Filter yang bisa Anda pakai:

- Status (Active / Completed / Cancelled).
- Contract type.
- Sort by start date / progress / name.

## Change password (rutin)

Untuk keamanan, ganti password Anda secara berkala.

Di dashboard → klik avatar Anda → **Change password**.

Isi:
- Current password.
- New password (rules sama seperti first-time).
- Confirm new password.

Klik **Update** → semua session lain (browser lain, HP) akan otomatis
logout. Anda tetap login di device ini.

## Sign out

Klik avatar Anda → **Sign out**. Session di-terminate immediately.

Untuk keamanan optimal, sign out ketika:

- Selesai review, terutama di komputer bersama.
- Ganti device / laptop.

## Troubleshooting

### "Login failed / Password salah"

- Pastikan email typing benar (case sensitive).
- Pastikan Anda pakai URL portal yang benar (subdomain vendor Anda).
- Kalau baru dapat temp password: pastikan Anda copy-paste tanpa spasi awal/akhir.
- Kalau tetap gagal, kontak admin vendor Anda untuk reset password.

Setiap login attempt Anda tercatat di sistem vendor (SUCCESS / FAILURE)
untuk audit — jadi kalau berkali-kali gagal, mereka bisa langsung
bantu.

### "Saya lupa URL portal"

Kontak PIC vendor Anda — mereka bisa share ulang URL + credentials Anda.

### "Data proyek tidak muncul"

Kemungkinan:

- Anda baru di-invite, vendor belum assign proyek ke perusahaan Anda.
- Anda login ke tenant yang salah (URL beda).
- Vendor menghapus akses Anda ke proyek tertentu.

Kontak admin vendor untuk konfirmasi.

### "Notifikasi tidak masuk"

- Cek folder spam email Anda (untuk notifikasi email).
- Kalau in-app bell tidak update: refresh page manual (`Cmd+R` / `Ctrl+R`).
- Kalau setelah refresh masih kosong: verify Anda di portal yang benar + akun benar (bukan akun lain di keluarga / perusahaan sama).

### "Saya melihat error 404 atau 'Not found'"

Kemungkinan Anda:

- Klik link ke proyek yang bukan milik perusahaan Anda (isolation aktif — Anda tidak boleh lihat proyek klien lain).
- Klik link yang sudah kadaluarsa (bookmark lama).

Kembali ke dashboard `/portal` dan navigate ulang.

## Privacy

Yang **vendor lihat** tentang Anda:

- Email login Anda.
- Waktu login + IP address + browser (untuk audit — retensi 7 tahun).
- Kapan Anda buka notifikasi + halaman apa yang di-view.

Yang **vendor TIDAK share** tentang mereka ke Anda:

- Detail transaksi internal (expense per karyawan, kas bon, gaji, dll).
- Data klien vendor lain.
- Data karyawan lengkap (hanya nama PM proyek Anda).

Untuk pertanyaan privacy dan retention, kontak Data Protection Officer vendor Anda.

## Feedback

Ada saran fitur atau bug? Kontak PIC vendor Anda dan minta di-forward ke tim ControlDesk. Include:

- Deskripsi masalah / saran.
- Screenshot (kalau ada).
- Perkiraan waktu terjadinya (untuk cross-ref log audit).

Terima kasih telah menggunakan ControlDesk Portal!
