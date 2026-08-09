# ControlDesk Hands-on Labs

Kumpulan **12 lab praktik** untuk program training. Peserta menyelesaikan
lab sendiri (atau berpasangan) dengan bantuan trainer sebagai fasilitator.

Baca [`README.md`](README.md) dan [`curriculum.md`](curriculum.md) dulu
supaya paham konteks setiap lab.

## Format lab

Setiap lab konsisten:

- **Tujuan** — outcome terukur.
- **Persona** — siapa yang login (dari
  [`../qa/e2e-roleplay.md#cast`](../qa/e2e-roleplay.md#cast--11-persona-internal--3-portal)).
- **Durasi** — estimasi realistis.
- **Prasyarat** — lab sebelumnya yang harus done.
- **Langkah** — numbered list.
- **Kriteria sukses** — checklist ✅/❌ yang bisa self-verify.
- **Troubleshooting** — 2–3 masalah umum + fix.

Setiap lab tersedia dalam **environment**:

- **Local Docker**: `http://demo.localhost:3001` (setelah `pnpm docker:app`).
- **Staging sandbox**: `https://training.controldesk.app`.

Password universal (dev + demo): **`ControlDesk#2026`**.

## Cara ukur waktu lab

Trainer set timer di setiap lab. Kalau > 1.5x estimasi masih macet →
pause dan review konsep bersama. Jangan biarkan peserta stuck > 20
menit tanpa bantuan.

---

## Lab 1 — Login, navigasi, toggle bahasa/tema

**Tujuan**: familiar dengan UI shell ControlDesk.

**Persona**: Ayu Admin (`admin@demo.controldesk.app`).

**Durasi**: 15 menit.

**Prasyarat**: Environment siap.

### Langkah

1. Buka `http://demo.localhost:3001/login` (atau URL sandbox).
2. Login dengan email + password universal.
3. Cek Anda mendarat di dashboard (`/`).
4. Klik **toggle 🇮🇩/🇬🇧** di kanan atas → verify bahasa berubah.
5. Klik **toggle dark/light theme** di topbar → verify warna berubah.
6. Tekan **Cmd+K** (Mac) / **Ctrl+K** (Win) → Command Palette terbuka.
7. Ketik "audit" → pilih "Audit log" → verify Anda diarahkan ke
   `/settings/audit-log`.
8. Kembali ke dashboard via klik logo di kiri atas.
9. Klik **bell icon** di topbar → verify list notifikasi (mungkin
   kosong di seed segar).
10. Klik **avatar profil** kanan atas → **Profile** → verify halaman
    `/profile` muncul dengan info Ayu Admin.

### Kriteria sukses ✅

- [ ] Login tanpa error dan Anda melihat dashboard.
- [ ] Toggle bahasa berhasil (lihat kata "Dashboard" → "Dasbor" atau
      sebaliknya).
- [ ] Command Palette terbuka dan berhasil navigate ke Audit log.
- [ ] Halaman Profile menampilkan email `admin@demo.controldesk.app`
      dan role `TENANT_ADMIN` / `ADMIN`.

### Troubleshooting

- **Login gagal / spin loading terus**: cek `.env.local` sudah copy dari
  `.env.example`. Untuk local, container `controldesk-app` di port
  3001 harus healthy (`docker ps`).
- **Halaman blank + 500**: cek log container
  (`pnpm docker:logs`). Kalau seed belum load, jalankan
  `pnpm db:reset` (di local).
- **Command Palette tidak terbuka**: pastikan focus tidak di input
  field. Coba dulu Escape lalu Cmd+K.

---

## Lab 2 — Baca audit log satu event

**Tujuan**: Peserta bisa membaca `security_audit_logs` dan
mengidentifikasi aktor + resource + old/new value.

**Persona**: Ayu Admin.

**Durasi**: 20 menit.

**Prasyarat**: Lab 1.

### Langkah

1. Login sebagai Ayu Admin.
2. Buka `/settings/audit-log` (atau via Command Palette).
3. Filter kolom: `resource_name` = `project_expenses`.
4. Sort by `created_at desc`.
5. Klik satu row → detail drawer terbuka.
6. Baca kolom:
   - `actor_id` → siapa yang bikin aksi.
   - `actor_role` → role saat aksi.
   - `action_type` → misal `EXPENSE_APPROVED`.
   - `old_values` → state sebelum.
   - `new_values` → state sesudah.
   - `ip_address`, `user_agent` → forensic.
7. Coba filter lagi dengan `actor_role` = `FINANCE` → hanya event
   Finance yang muncul.

### Kriteria sukses ✅

- [ ] Bisa menyebutkan siapa aktor + apa action_type + apa yang berubah
      untuk 1 audit event tertentu.
- [ ] Filter by role bekerja.

### Troubleshooting

- **List kosong**: seed segar mungkin belum ada expense. Balik dulu ke
  Lab 5 kemudian ulang Lab 2.
- **Detail drawer tidak muncul**: refresh browser + retry.

---

## Lab 3 — Bikin Client + Project

**Tujuan**: Membangun master data proyek dari nol.

**Persona**: Omar Operations (`om@demo.controldesk.app`).

**Durasi**: 25 menit.

**Prasyarat**: Lab 1.

### Langkah

1. Login sebagai Omar Operations.
2. Buka `/clients` → **New client**.
3. Isi:
   - Name: `PT Contoh Sejahtera`
   - Industry: `Retail`
   - Contact person: `Bapak Rahmat`
   - Email: `contact@contohsejahtera.example`
   - Phone: `+62 21 555 1234`
4. Save → verify client muncul di list.
5. Klik row client → tab **Projects** → **New project**.
6. Isi:
   - Code: `RTL-2026-001`
   - Name: `Retail POS Rollout Batch 3`
   - Contract type: `ONE_OFF`
   - Start date: hari ini
   - End date: hari ini + 90 hari
   - Budget amount: `IDR 250.000.000`
7. Save → project status default `DRAFT`.
8. Klik project → change status ke `PLANNED`.
9. Buka tab **PM assignments** → **Assign PM**:
   - Employee: `Putri PM`
   - Role: `PRIMARY_PM`
10. Buka tab **Employee assignments** → **Assign employee**:
    - Employee: `Eko Employee`
    - Role on project: `STAFF`
    - Allocation: `50%`

### Kriteria sukses ✅

- [ ] Client + project + 1 PM + 1 employee ter-assign.
- [ ] Project status = `PLANNED`.
- [ ] Total alokasi Eko Employee di semua project ≤ 100% (cek di
      profil employee).

### Troubleshooting

- **"ALLOCATION_OVERBOOKED"**: Eko sudah ke-assign 100% di seed. Turunkan
  ke 30% atau pilih employee lain.
- **PM assignment error "PRIMARY_PM_ALREADY_EXISTS"**: unassign PM lama
  dulu, atau assign sebagai `CO_PM`.

---

## Lab 4 — Build WBS + Gantt

**Tujuan**: Membangun WBS hierarkis lalu memanipulasinya di Gantt.

**Persona**: Putri PM (`pm@demo.controldesk.app`).

**Durasi**: 30 menit.

**Prasyarat**: Lab 3 (project sudah ada) — atau pakai project
**KIRA-DA** seed (yang sudah punya 23 dummy task).

### Langkah

**A. WBS Tree**

1. Login sebagai Putri PM.
2. Buka project **Retail POS Rollout Batch 3** (dari Lab 3) atau
   **KIRA-DA**.
3. Scroll ke section **Tasks** → tab **WBS Tree**.
4. Klik **New task**:
   - Name: `Phase 1 — Discovery`
   - Planned start: hari ini
   - Planned end: hari ini + 14 hari
   - Weight: 30
5. Save → task muncul dengan `wbs_code = 1`.
6. Klik ⋯ di row → **Add sub-task**:
   - Name: `Stakeholder interviews`
   - Owner: Eko Employee
   - Planned start: hari ini
   - Planned end: hari ini + 7 hari
   - Weight: 60
7. Save → sub-task muncul dengan `wbs_code = 1.1`, di-indent.
8. Ulangi untuk `1.2` = `Requirements document` (owner: Putri PM,
   planned hari ini+7 → +14, weight 40).
9. Set status task 1.1 ke `IN_PROGRESS` → `actual_start_date`
   auto-stamp hari ini.
10. Set progress 1.1 ke 50% → verify parent "Phase 1 — Discovery"
    `rolled_progress` update.

**B. Gantt Chart**

11. Klik tab **Gantt Chart**.
12. Verify task hierarki muncul dengan bar horizontal.
13. **Drag bar** 1.1 (Stakeholder interviews) ke kanan 3 hari →
    verify tanggal update.
14. Refresh browser (F5) → verify perubahan persist.
15. **Drag progress handle** 1.1 dari 50% ke 100% → verify status
    otomatis boleh `DONE` (di dialog konfirmasi).
16. Toggle view mode ke **Month** → verify tampilan berubah.
17. Kalau ada task tanpa planned date, lihat panel **Unplanned
    tasks** di bawah Gantt → klik untuk isi tanggal.

### Kriteria sukses ✅

- [ ] Minimal 3 task berhasil dibuat (1 parent + 2 sub-task).
- [ ] `wbs_code` benar (1, 1.1, 1.2).
- [ ] Rolled progress parent update saat sub-task diubah.
- [ ] Drag Gantt berhasil dan persist.
- [ ] Status transition IN_PROGRESS memicu `actual_start_date` auto.

### Troubleshooting

- **Gantt bar tidak muncul**: task tanpa `planned_start_date` +
  `planned_end_date` tidak muncul di bar chart, hanya di "Unplanned
  tasks" panel. Isi tanggal dulu.
- **Sub-task tidak indent di tree**: refresh browser. `parent_task_id`
  mungkin tidak ter-set. Edit task → set parent → save.
- **"CYCLE_DETECTED"**: coba reorder yang bikin parent = descendant
  sendiri. Undo action, pilih parent lain.

---

## Lab 5 — Expense kecil (< 5M) end-to-end

**Tujuan**: Menjalankan alur Expense Finance-only.

**Persona**: Eko Employee → Fajar Finance.

**Durasi**: 20 menit.

**Prasyarat**: Lab 3 project ada + Eko assigned.

### Langkah

1. Login **Eko Employee**.
2. Buka project (KIRA-DA atau hasil Lab 3).
3. Tab **Expenses** → **New expense**.
4. Isi:
   - Category: `Materials`
   - Description: `Kabel LAN Cat6 100 meter`
   - Amount: `IDR 4.500.000`
   - Attach receipt: upload dummy PDF (max 10 MB).
5. Submit → status `PENDING_FINANCE`.
6. Logout Eko → Login **Fajar Finance** (`finance@demo.controldesk.app`).
7. Buka bell icon → verify notifikasi "New expense to approve" muncul.
8. Klik → arah ke `/approvals` inbox → klik expense → **Approve** +
   isi komentar "Verified receipt".
9. Verify status → `Approved` lalu (auto) `Paid`.
10. Logout Fajar → Login Eko → verify notifikasi "Your expense approved"
    di bell.

### Kriteria sukses ✅

- [ ] Expense submit sukses dengan receipt attached.
- [ ] Chain **hanya Finance** (bukan PM) karena `< 5M`.
- [ ] Notifikasi diterima Eko setelah approve.
- [ ] Audit log punya 2 event: `EXPENSE_SUBMITTED` + `EXPENSE_APPROVED`.

### Troubleshooting

- **Upload receipt gagal**: file > 10 MB atau MIME bukan
  jpg/png/webp/pdf. Coba PDF kecil.
- **Approve button tidak muncul**: Fajar mungkin belum ada di chain
  karena project di tenant lain. Cek isolation.

---

## Lab 6 — Cash Advance General (5M–20M, PM + Finance)

**Tujuan**: Menjalankan chain 2-step (PM + Finance).

**Persona**: Eko Employee → Putri PM → Fajar Finance.

**Durasi**: 25 menit.

**Prasyarat**: Lab 5.

### Langkah

1. Login **Eko Employee**.
2. Buka project → tab **Cash advances** → **New advance**.
3. Isi:
   - Type: `General`
   - Purpose: `Training vendor onsite Bandung 3 hari`
   - Amount: `IDR 8.000.000`
   - Expected settlement date: hari ini + 14 hari
4. Submit → chain preview: **PM → Finance** (karena 5M ≤ 8M < 20M).
5. Login **Putri PM** → approvals inbox → approve dengan komentar.
6. Login **Fajar Finance** → approve → status `APPROVED`.
7. Fajar klik **Disburse** → pilih metode `Bank Transfer` → status
   `DISBURSED`.
8. Eko terima notifikasi + `disbursed_at` ter-stamp.

### Kriteria sukses ✅

- [ ] Chain PM → Finance jalan sesuai urutan (paralel juga OK — kedua
      slot bisa disi bareng).
- [ ] Status akhir `DISBURSED`.
- [ ] `expected_settlement_date` tampil di CA detail.

### Troubleshooting

- **PM approve tidak muncul**: cek PM assignment. Kalau bukan Putri
  yang assigned ke project, ganti persona ke PM yang tepat.

---

## Lab 7 — Cash Advance Field Ops (Supervisor rung 0)

**Tujuan**: Beda chain Field Ops dari General.

**Persona**: Eko Employee → Sinta Supervisor → Fajar Finance.

**Durasi**: 25 menit.

**Prasyarat**: Lab 6.

### Langkah

1. Login **Eko Employee**.
2. Project → Cash advances → **New advance**.
3. Isi:
   - Type: `Field Ops`
   - Ticket ref: `TCK-2026-0042`
   - Site location: `Warehouse Bandung`
   - Justification: `IncidentResponse`
   - Vehicle type: `MobilKantor`
   - Amount: `IDR 3.500.000`
   - RAB line items: `Bensin 500K`, `Toll 200K`, `Makan 300K`, `Parkir
     50K`, `LainLain 2450K`.
4. Submit → chain preview: **Supervisor → Finance** (karena < 5M, PM
   tidak di chain).
5. Login **Sinta Supervisor** → approvals → approve dengan komentar
   "Confirmed site issue at Bandung warehouse".
6. Login **Fajar Finance** → approve → disburse.
7. Perhatikan `settlement_due_date` = `disbursed_at + 10 hari`.

### Kriteria sukses ✅

- [ ] Chain **Supervisor** ada sebagai rung 0 (WAJIB untuk Field Ops).
- [ ] PM slot **tidak** muncul karena amount < 5M.
- [ ] Settlement due date auto-stamp +10 hari kalender.

### Troubleshooting

- **Sinta tidak lihat CA di inbox**: Sinta harus jadi supervisor line
  manager Eko. Cek `employees.reports_to_employee_id`.

---

## Lab 8 — Petty Cash spend + reconciliation

**Tujuan**: Imprest fund system + variance handling.

**Persona**: Pandu Petty (custodian) → Fajar Finance.

**Durasi**: 25 menit.

**Prasyarat**: Sandbox punya petty cash fund seeded (`Jakarta HQ Fund`).

### Langkah

1. Login **Pandu Petty**.
2. Buka `/finance/petty-cash` → verify fund `Jakarta HQ Fund` tampil
   dengan `current_balance`.
3. Klik fund → **New entry** → `Spend`:
   - Amount: `IDR 150.000`
   - Description: `Alat tulis kantor`
   - Attach receipt (PDF).
4. Submit → karena `< 200K`, status auto `Approved` → **Post** →
   `current_balance` turun 150K.
5. Buat entry lagi: `Spend` `IDR 1.500.000` untuk `Meeting catering`.
6. Submit → status `PENDING_FINANCE` (karena `≥ 200K`).
7. Login **Fajar Finance** → approve → Pandu **Post** → balance turun.
8. Login **Pandu Petty** → **New reconciliation**:
   - Period end: hari ini
   - Physical count: `current_balance - 5000` (contoh variance 5000).
   - Variance reason: `Belum receipt untuk parkir 5000 kemarin`.
9. Submit → tampil di reconciliation list dengan variance flag.

### Kriteria sukses ✅

- [ ] Spend < 200K auto-approve (tidak masuk queue Finance).
- [ ] Spend 200K–2M butuh Finance approval.
- [ ] Reconciliation dengan variance > tolerance (5000) minta reason
      teks.

### Troubleshooting

- **"MAX_SPEND_AMOUNT_EXCEEDED"** saat coba > 2M: benar — petty cash
  dilarang > 2M, harus lewat Expense.

---

## Lab 9 — Weekly timesheet submit + approve

**Tujuan**: Alur timesheet weekly packet.

**Persona**: Eko Employee → Putri PM.

**Durasi**: 20 menit.

**Prasyarat**: Eko assigned ke minimal 1 project aktif.

### Langkah

1. Login **Eko Employee**.
2. Buka `/hr/timesheets/weekly`.
3. Pilih minggu lalu (Senin–Minggu).
4. Isi hari Senin–Jumat: 8 jam per hari ke project KIRA-DA.
   Description: "Development annotation UI".
5. Sabtu–Minggu: kosong (weekend).
6. **Submit packet** → status `SUBMITTED`.
7. Login **Putri PM** → approvals inbox → open packet → verify 5
   entry × 8 jam = 40 jam total.
8. **Approve** → status `APPROVED` → optional auto-lock 0 hari →
   `LOCKED`.

### Kriteria sukses ✅

- [ ] Packet berisi 5 entry (Senin–Jumat) tanpa error.
- [ ] Total jam mingguan = 40 (baseline; overtime hanya kalau > 40).
- [ ] Approve sekali cukup untuk semua 5 entry.

### Troubleshooting

- **"HOURS_EXCEED_24"**: entry harian > 24 jam pasti typo. Ubah.
- **Project dropdown kosong**: Eko tidak ke-assign ke project aktif
  manapun. Kembali ke Lab 3.

---

## Lab 10 — HR request cuti + approval chain

**Tujuan**: Alur HR request 2-tier (Supervisor + PM).

**Persona**: Eko Employee → Sinta Supervisor → Putri PM.

**Durasi**: 20 menit.

**Prasyarat**: Lab 1.

### Langkah

1. Login **Eko Employee**.
2. `/hr/requests` → **New request**:
   - Kind: `LEAVE`
   - Leave type: `Annual`
   - Start: hari ini + 7
   - End: hari ini + 10
   - Reason: "Family event"
3. Submit → status `PENDING_L1_SUPERVISOR`.
4. Login **Sinta Supervisor** → approve L1 → status
   `PENDING_L2_PM`.
5. Login **Putri PM** → approve L2 → status `APPROVED`.
6. Verify di kalender leaves Eko muncul 3 hari.

### Kriteria sukses ✅

- [ ] Chain 2-tier jalan (Supervisor lalu PM).
- [ ] `SICK` request menuntut upload surat dokter (coba juga variant
      ini dan verify Zod block kalau tidak upload).

### Troubleshooting

- **Overlap dengan cuti lain**: sistem tidak block overlap secara
  otomatis (Fase 0 belum ada leave calendar validation). PM harus
  visual check.

---

## Lab 11 — SMTP setup + verify

**Tujuan**: Setup + verify SMTP per-tenant + kirim test notification.

**Persona**: Ayu Admin.

**Durasi**: 15 menit.

**Prasyarat**: Lab 1.

### Langkah

1. Login **Ayu Admin**.
2. Buka `/settings/integrations/smtp`.
3. Isi form:
   - Host: `controldesk-mailpit` (local Docker) atau SMTP staging.
   - Port: `1025`.
   - Username: kosong.
   - Password: kosong.
   - From email: `noreply@demo.controldesk.app`.
   - From name: `ControlDesk Demo`.
4. Klik **Verify** → tunggu spinner → verify pesan sukses.
5. Save (row `verified=true`).
6. Kirim **Test email** → cek Mailpit UI di `http://localhost:8025`.

### Kriteria sukses ✅

- [ ] Verify berhasil (green check).
- [ ] Test email muncul di Mailpit inbox.
- [ ] Password ter-encrypt di DB (verify via
      `select smtp_password_encrypted from tenant_smtp_configs limit 1;`
      — hasil tidak plain-text).

### Troubleshooting

- **Verify gagal "ECONNREFUSED"**: Mailpit belum jalan.
  `pnpm docker:deps` untuk start Redis + Mailpit.
- **Test email tidak muncul di Mailpit**: cek "From email" tidak
  `noreply@example.com` (sebagian SMTP block domain reserved).

---

## Lab 12 — WhatsApp Fonnte pairing + test-send

**Tujuan**: Setup Fonnte device + test WA notification.

**Persona**: Ayu Admin + nomor HP user demo.

**Durasi**: 20 menit.

**Prasyarat**: Lab 1. Punya akun Fonnte sandbox atau dummy device
token.

### Langkah

1. Login **Ayu Admin**.
2. Buka `/settings/integrations/whatsapp-business`.
3. Pilih provider: `Fonnte`.
4. Isi:
   - Device token: `<TOKEN dari Fonnte sandbox>`.
   - Sender number: `+62811xxxxxxx`.
5. Klik **Verify** → tunggu Fonnte respond.
6. Save.
7. **Link user** ke Ayu Admin sendiri: klik "Link my number" → isi
   nomor Ayu → sistem kirim OTP → paste OTP kembali.
8. Kirim **Test message** → tunggu notifikasi masuk WA.

### Kriteria sukses ✅

- [ ] Device paired (`verified=true`).
- [ ] Nomor Ayu ter-link ke user_id-nya (`user_whatsapp_links` punya row).
- [ ] Test message diterima di WA.

### Troubleshooting

- **Device offline**: cek Fonnte dashboard — device HP harus aktif +
  online.
- **OTP tidak masuk**: cek rate limit Fonnte + nomor benar (WA
  E.164).
- **"unofficial WA gateway warning"**: normal — Fonnte adalah unofficial.
  Untuk production tenant compliance-sensitive, gunakan Twilio.

---

## Ringkasan lab matrix (per track)

| Lab | Topik                             | T1 | T2 | T3 | T4 | Durasi |
| --- | --------------------------------- | -- | -- | -- | -- | ------ |
| 1   | Login + nav                       | ✅ | ✅ | ✅ | ✅ | 15m    |
| 2   | Audit log                         | ✅ | ✅ | ✅ | ✅ | 20m    |
| 3   | Client + Project                  | -  | ✅ | -  | -  | 25m    |
| 4   | WBS + Gantt                       | ✅ | ✅ | -  | -  | 30m    |
| 5   | Expense small                     | ✅ | ✅ | ✅ | -  | 20m    |
| 6   | CA General 5M–20M                 | -  | ✅ | ✅ | -  | 25m    |
| 7   | CA Field Ops                      | ✅ | ✅ | ✅ | -  | 25m    |
| 8   | Petty Cash + recon                | -  | -  | ✅ | -  | 25m    |
| 9   | Weekly timesheet                  | ✅ | ✅ | -  | -  | 20m    |
| 10  | HR request cuti                   | ✅ | ✅ | -  | -  | 20m    |
| 11  | SMTP setup + verify               | -  | -  | -  | ✅ | 15m    |
| 12  | WhatsApp Fonnte pairing           | -  | -  | -  | ✅ | 20m    |

**Total durasi lab per track**:
- T1 Operator: 15+20+30+20+25+20+20 = **150 menit**
- T2 Delivery: 15+20+25+30+20+25+25+20+20 = **200 menit**
- T3 Finance: 15+20+20+25+25+25 = **130 menit**
- T4 Admin: 15+20+15+20 = **70 menit**

## Setelah semua lab selesai

Peserta yang sudah lulus semua lab track-nya lanjut ke assessment di
[`evaluation.md`](evaluation.md).
