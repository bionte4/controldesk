# ControlDesk Training Hub

Panduan resmi persiapan **pelatihan pengguna ControlDesk** — baik onboarding
tenant baru, upskill karyawan lama, maupun refresher setelah rilis fitur
besar. Doc ini adalah **pintu masuk**; materi lengkap dibagi ke empat
dokumen turunan di folder yang sama.

| Doc                                                           | Untuk siapa                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| [`README.md`](README.md) (Anda di sini)                       | Semua stakeholder — pahami program & pilih track Anda           |
| [`curriculum.md`](curriculum.md)                              | Program Manager & Trainer — silabus 6 sesi + role tracks        |
| [`hands-on-labs.md`](hands-on-labs.md)                        | Peserta & Trainer — 12 lab praktik dengan step-by-step          |
| [`facilitator-guide.md`](facilitator-guide.md)                | Trainer / Instructor — persiapan, timing, tips, contingency     |
| [`evaluation.md`](evaluation.md)                              | Program Manager & Trainer — rubrik penilaian, quiz, sign-off    |

## Tujuan program

Setelah program training selesai, peserta bisa:

1. **Menjelaskan** arsitektur multi-tenant + model role canonical (7
   internal + 1 portal) ControlDesk.
2. **Menjalankan** end-to-end alur bisnis inti (Client → Project → WBS →
   Timesheet → Expense/CA → Petty Cash → Approval) sesuai role masing-masing.
3. **Menkonfigurasi** integrasi eksternal (SMTP, WhatsApp, Telegram, AI,
   Google Calendar) sampai `verified` di UI.
4. **Menemukan** audit trail & mengaudit sebuah keputusan approval
   sampai ke aktor dan `security_audit_logs`.
5. **Mengatasi** insiden dasar (session expired, RLS denial, approval
   stuck) tanpa eskalasi ke engineer.

Peserta lulus program bila memenuhi kriteria **assessment** di
[`evaluation.md`](evaluation.md).

## Audiens & role tracks

Materi terbagi ke **4 track paralel** berdasarkan pekerjaan real
peserta. Peserta hanya perlu mengikuti track yang relevan + sesi
Foundation yang wajib untuk semua.

| Track                          | Untuk                                                             | Sesi wajib                                       | Durasi total |
| ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------ | ------------ |
| **T0 — Foundation**            | Semua peserta                                                     | S1                                               | 2 jam        |
| **T1 — Operator**              | Employee · Supervisor                                             | S1 · S2 · S4                                     | 6 jam        |
| **T2 — Project & Delivery**    | Project Manager · Operations Manager                              | S1 · S2 · S3 · S4                                | 9 jam        |
| **T3 — Finance & Governance**  | Finance · Director · Petty Cash Custodian                         | S1 · S3 · S6                                     | 7 jam        |
| **T4 — Admin & Integration**   | Tenant Admin · HR Admin · IT Support tenant                       | S1 · S5 · S6                                     | 6 jam        |

Rincian sesi (S1–S6) ada di [`curriculum.md`](curriculum.md).

## Prasyarat

**Peserta** harus punya:

- Laptop dengan Chrome / Edge / Firefox terbaru.
- Akun email aktif (untuk terima invitation dari Tenant Admin).
- Password sementara **`ControlDesk#2026`** (khusus environment training).
- Familiar dengan konsep dasar approval workflow (tidak perlu tahu SQL/kode).

**Program Manager (di sisi tenant)** harus siapkan:

- 1 Tenant Admin yang sudah bisa login production/staging.
- Nama peserta + email + role rencana (per role canonical).
- Waktu training (2–3 hari kerja terpisah lebih baik dari 1 hari
  padat — otak butuh sleep untuk consolidate).

**Trainer** harus setup sandbox — lihat
[`facilitator-guide.md#sandbox-setup`](facilitator-guide.md#sandbox-setup).

## Format & timeline yang direkomendasikan

**Format hybrid** (2 hari @ 4 jam) lebih efektif dari full-day 8 jam.

**Jadwal 2-hari (rekomendasi utama)**:

```
Hari 1 (Foundation + core operations)
  09:00–10:30  S1 Foundation (WAJIB semua)
  10:30–10:45  Break
  10:45–12:15  S2 Client & Project (T1, T2)
  12:15–13:30  Lunch
  13:30–15:00  S4 HR & Timesheet (T1, T2)
  15:00–15:15  Break
  15:15–16:45  Lab 1–4 (hands-on)

Hari 2 (Finance + admin + integration)
  09:00–11:00  S3 Finance & Approval (T2, T3)
  11:00–11:15  Break
  11:15–12:15  S6 Admin & Governance (T3, T4)
  12:15–13:30  Lunch
  13:30–14:30  S5 Integrations (T4)
  14:30–14:45  Break
  14:45–16:00  Lab 5–10 (hands-on)
  16:00–16:45  Assessment + Q&A + closing
```

**Format alternatif** untuk cohort kecil (< 5 peserta) atau follow-up
refresher: **micro-sessions** — 1 jam per minggu selama 6 minggu, satu
sesi per meeting.

## Environment training

Peserta latihan di **sandbox tenant** yang terpisah dari production
tenant mereka. Sandbox:

- **URL**: `https://training.controldesk.app` (staging) atau
  `http://demo.localhost:3001` (local Docker prod bila offline).
- **Tenant slug**: `demo` (multi-user, isolated dari tenant produksi).
- **Password universal**: `ControlDesk#2026` (harus di-rotate setelah
  training selesai — cek runbook rotation di
  [`../ops/secret-rotation.md`](../ops/secret-rotation.md)).
- **Reset schedule**: sandbox di-`pnpm db:reset` **setiap hari
  jam 06:00 WIB** oleh cron — data seed segar untuk cohort berikutnya.
- **Persona seed**: 11 persona internal (Ayu Admin, Putri PM, Eko
  Employee, dst) + 3 portal user siap login. Catalog lengkap di
  [`../qa/e2e-roleplay.md#cast`](../qa/e2e-roleplay.md#cast--11-persona-internal--3-portal).

Rincian setup + rollback per cohort di
[`facilitator-guide.md#sandbox-setup`](facilitator-guide.md#sandbox-setup).

## Materi rujukan

Training mengarahkan peserta ke doc production yang sudah ada — bukan
menciptakan pengetahuan baru. Semua yang diajar sudah ada rujukannya:

| Kalau peserta bertanya…                        | Rujuk ke                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Apa itu ControlDesk?                           | [`../product/overview.md`](../product/overview.md)                                             |
| Role apa saja + bisa apa?                      | [`../product/roles-and-permissions.md`](../product/roles-and-permissions.md)                   |
| Threshold approval berapa?                     | [`../product/approval-workflows.md`](../product/approval-workflows.md)                         |
| Cara pakai Client Portal?                      | [`../user-guides/client-portal-users.md`](../user-guides/client-portal-users.md)               |
| Cara pakai fitur harian per role?              | [`../user-guides/internal-users.md`](../user-guides/internal-users.md)                         |
| Cara setup WhatsApp / SMTP / AI / Telegram?    | [`../integrations/README.md`](../integrations/README.md)                                       |
| Istilah bisnis / akronim?                      | [`../product/glossary.md`](../product/glossary.md)                                             |
| Report bug atau masalah pas training?          | [`../qa/bug-reporting.md`](../qa/bug-reporting.md)                                             |

## Sukses metric untuk program

Ukur efektifitas training via 3 KPI:

1. **Attendance**: ≥ 90% peserta yang di-list hadir minimal 80% sesi.
2. **Assessment pass rate**: ≥ 85% peserta mencapai skor ≥ 70% di
   assessment akhir ([`evaluation.md`](evaluation.md)).
3. **Post-30-day competency**: 30 hari setelah training, peserta bisa
   menyelesaikan alur harian mereka **tanpa** eskalasi ke Tenant
   Admin > 2 kali/minggu. Diukur via `security_audit_logs` filter
   `actor_id = peserta`.

Trainer mengirim laporan akhir program ke Program Manager tenant + tim
Product ControlDesk (`training@controldesk.app`) — template ada di
[`facilitator-guide.md#pelaporan-akhir`](facilitator-guide.md#pelaporan-akhir).

## Perubahan program

Setiap kali fitur baru rilis (misal WBS + Gantt, integrasi baru,
threshold rework), materi training **wajib** di-update di PR yang sama
supaya kohort berikutnya tidak belajar barang lama. Tanggung jawab
di-attach ke `CODEOWNERS` untuk `docs/training/*`.

**Changelog training**:

- **2026-08** — WBS + Gantt (§Projects) ditambah ke S2 + Lab 3.
- **2026-08** — Per-tenant SMTP/WhatsApp/AI di S5 (menggantikan lab
  Fonnte-only).
- **2026-08** — Approval threshold admin UI di S6 (menggantikan
  "hardcoded config").
- **2026-07** — Login redesign (split-panel) — screenshot di
  [`hands-on-labs.md`](hands-on-labs.md) di-refresh.

## Kontak

- Isi program training: **Product ControlDesk** — `product@controldesk.app`.
- Bug materi training: file issue GitHub label `docs/training` di
  repo [`bontiharyanto/controldesk`](https://github.com/bontiharyanto/controldesk).
- Sponsor internal tenant Anda: **Tenant Admin** yang meng-invite
  Anda.
