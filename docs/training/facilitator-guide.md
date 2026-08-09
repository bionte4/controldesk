# ControlDesk Facilitator Guide

Panduan operasional untuk **trainer / instructor / facilitator** yang
akan menjalankan program training ControlDesk. Baca [`README.md`](README.md)
dan [`curriculum.md`](curriculum.md) dulu supaya paham struktur program.

Doc ini menjawab: **"bagaimana saya menjalankan training yang sukses?"** —
dari persiapan H-14 sampai laporan akhir program.

## Table of contents

- [Persiapan H-14 sampai H-1](#persiapan-h-14-sampai-h-1)
- [Sandbox setup](#sandbox-setup)
- [Persiapan materi trainer](#persiapan-materi-trainer)
- [Menjalankan sesi kelas](#menjalankan-sesi-kelas)
- [Fasilitasi lab hands-on](#fasilitasi-lab-hands-on)
- [Handling kondisi khusus](#handling-kondisi-khusus)
- [Assessment day](#assessment-day)
- [Post-training clean-up](#post-training-clean-up)
- [Pelaporan akhir](#pelaporan-akhir)
- [Kompetensi minimum trainer](#kompetensi-minimum-trainer)

## Persiapan H-14 sampai H-1

Timeline mundur dari hari-1 training:

### H-14 (dua minggu sebelum)

- [ ] Kirim **assessment awal** ke calon peserta (Google Form 10
      pertanyaan) — cek prior familiarity dengan ERP/BPO tools.
      Hasilnya bantu Anda tune contoh & pace.
- [ ] Konfirmasi **daftar peserta final** dari Program Manager tenant
      (nama + email + role rencana).
- [ ] Reserve ruangan / meeting link Zoom-Google Meet + record permission.
- [ ] Cek kalender **peserta** — hindari overlap dengan month-end
      close atau go-live besar.

### H-7 (satu minggu sebelum)

- [ ] Kirim **welcome email** ke peserta dengan:
  - Jadwal 2 hari + link Zoom.
  - Link ke [`README.md`](README.md) dan [`hands-on-labs.md`](hands-on-labs.md).
  - Prasyarat: laptop dengan Chrome/Edge, koneksi stabil.
  - Password sandbox sementara: `ControlDesk#2026`.
  - URL sandbox: `https://training.controldesk.app` atau local Docker.
- [ ] Provision **sandbox tenant** — lihat [Sandbox setup](#sandbox-setup).
- [ ] Test setiap lab **sendiri** dari awal sampai akhir — Anda harus
      bisa selesaikan setiap lab dalam waktu yang di-estimate.

### H-3

- [ ] Kirim **reminder email** ke peserta + minta mereka login sekali
      ke sandbox untuk verify credential jalan.
- [ ] Print handout ringkas (opsional) — kalau training offline.
- [ ] Test AV di ruangan (proyektor, mic, share screen).

### H-1 (hari sebelum)

- [ ] Reset sandbox: `pnpm db:reset` (di local) atau trigger reset
      pipeline (staging).
- [ ] Verify semua persona bisa login dengan password universal.
- [ ] Verify Mailpit / SMTP relay siap (untuk lab 11).
- [ ] Punya **backup slide deck** (PDF) yang bisa Anda serve kalau
      sandbox down.

## Sandbox setup

Sandbox training terpisah dari production untuk isolation +
data-reset friendly.

### Environment recommended

**Opsi A — Staging shared (recommended untuk cohort besar)**:

- URL: `https://training.controldesk.app`.
- Tenant slug: `demo`.
- Dikelola oleh tim Product ControlDesk.
- Auto-reset cron **06:00 WIB setiap hari** — data hasil training
  kemarin di-wipe.

**Opsi B — Local Docker (recommended untuk cohort < 5 peserta)**:

- Trainer host di laptopnya + share via tunnel (ngrok / cloudflared).
- Reset manual: `pnpm db:reset` sebelum training + antara sesi.
- Port: `3001` (prod build) — lihat
  [`../getting-started.md`](../getting-started.md).

**Opsi C — Per-peserta local Docker**:

- Setiap peserta clone repo + `pnpm docker:app`.
- Cocok untuk **engineer training** (bukan business user).
- Setup awal 30–60 menit — reduce ke S1 opening bila pilih opsi ini.

### Provisioning steps (opsi B — local Docker)

```bash
git clone https://github.com/bontiharyanto/controldesk.git
cd controldesk
cp .env.example .env.local
# edit APP_ENCRYPTION_KEY dan LLM API keys sesuai kebutuhan

pnpm install
pnpm supabase:start          # Supabase CLI stack (54321, 54322, ...)
pnpm db:reset                 # migrasi + seed persona + WBS dummy
pnpm docker:deps              # Redis + Mailpit
pnpm docker:rebuild           # build Next.js standalone image
pnpm docker:app               # jalan di http://localhost:3001
```

Verify:

- `curl http://localhost:3001/api/health` → `{"status":"ok"}`.
- Buka `http://demo.localhost:3001/login` → login sebagai
  `admin@demo.controldesk.app` / `ControlDesk#2026` → landing di
  dashboard.
- Buka project KIRA-DA → verify 23 WBS task dummy tampil di section
  Tasks (untuk lab 4).

### Sandbox persona catalog

11 persona internal + 3 portal user auto-seeded oleh
`supabase/seed.sql`. Catalog lengkap di
[`../qa/e2e-roleplay.md#cast`](../qa/e2e-roleplay.md#cast--11-persona-internal--3-portal).

**Persona yang paling sering dipakai lab**:

| Persona          | Email                              | Role          | Pakai di lab       |
| ---------------- | ---------------------------------- | ------------- | ------------------ |
| Ayu Admin        | `admin@demo.controldesk.app`       | ADMIN         | 1, 2, 11, 12       |
| Omar Operations  | `om@demo.controldesk.app`          | OM            | 3                  |
| Putri PM         | `pm@demo.controldesk.app`          | PM            | 3, 4, 6, 7, 9, 10  |
| Sinta Supervisor | `supervisor@demo.controldesk.app`  | SUPERVISOR    | 7, 10              |
| Eko Employee     | `employee@demo.controldesk.app`    | EMPLOYEE      | 5, 6, 7, 9, 10     |
| Fajar Finance    | `finance@demo.controldesk.app`     | FINANCE       | 5, 6, 7, 8         |
| Pandu Petty      | `pettycash@demo.controldesk.app`   | FINANCE       | 8                  |

### Reset antar cohort

Kalau menjalankan **cohort back-to-back** di hari yang sama:

```bash
pnpm db:reset       # local Docker
# ATAU
gh workflow run reset-sandbox.yml --ref main    # staging (kalau CI dikelola)
```

Beri jeda **10 menit** untuk seed selesai load sebelum cohort baru
mulai lab.

## Persiapan materi trainer

### Slide deck

Setiap sesi punya deck sendiri di
`docs/training/slides/` (planned — sementara pakai
[`curriculum.md`](curriculum.md) sebagai outline). Trainer boleh:

- Adapt slides ke narasi bahasa lokal (Indonesia lebih hangat, sedikit
  humor).
- Tambah screenshot dari deployment tenant Anda sendiri (kalau
  peserta datang dari tenant yang sudah live).
- Sisipkan case study real (tanpa PII) dari tenant Anda.

### Whiteboard / iPad live drawing

Sangat direkomendasikan untuk topik konseptual:

- **S1** — gambar 3 tenant + RLS boundary (biar visual bahwa tenant A
  tidak lihat data tenant B).
- **S3** — gambar approval chain sebagai timeline horizontal dengan
  slot PM / Finance / Director; jelaskan Finance = parallel gate.
- **S6** — gambar retention timeline 7/10 tahun + anonymize vs delete.

### Contoh kasus (Indonesian context)

Peserta lebih engage dengan contoh dari konteks bisnis mereka:

- **Retail / F&B**: POS installation project → milestone Kickoff → UAT
  → Go-Live; WBS ubah per outlet.
- **IT Services**: Managed service kontrak retainer → monthly report
  cycle; SLA breach handling.
- **Field Ops**: Site visit engineer ke tower BTS → Field Ops CA →
  settlement dengan struk parkir/toll.

## Menjalankan sesi kelas

### Timing template (60–120 menit)

Break tetap **jam 60 menit sekali** minimum. Otak butuh reset:

```
[Opening 5m]  Recap sesi lalu + agenda sesi ini
[Body 35m]    Concept explanation + slides + whiteboard
[Break 10m]   Stretch + toilet
[Demo 15m]    Live demo trainer (peserta boleh screenshot)
[Q&A 15m]     Diskusi + antisipasi lab berikutnya
```

Untuk sesi 90 menit tambah 1 blok konsep + 1 demo (total 3 body +
2 demo + 1 Q&A).

### Interaction pattern

**Jangan** ceramah > 20 menit tanpa interaksi. Selipkan:

- **Cek pemahaman** — "Kalau saya Employee, dan saya submit expense
  IDR 7.5 juta, siapa approver saya?" (jawab: PM + Finance karena
  tier 5M–50M).
- **Live poll** — Zoom poll / mentimeter, 2–3 opsi. Gunakan untuk
  concept check.
- **Pair discussion** — 2 menit peserta bahas berpasangan → 1 dari
  mereka share.

### Aturan "no dumb question"

Establish di S1: **peserta boleh tanya apapun tanpa malu**. Jawab
dengan respect walau pertanyaan basic. Kalau di luar scope, catat →
share via chat/doc setelah sesi.

## Fasilitasi lab hands-on

### Sebelum lab dimulai

- Screen-share **halaman lab** di
  [`hands-on-labs.md`](hands-on-labs.md).
- Baca **Tujuan** + **Kriteria sukses** dengan suara keras.
- Umumkan waktu: "Silakan mulai sekarang, Anda punya 25 menit. Kalau
  stuck lebih dari 5 menit di satu step, panggil saya di chat."

### Selama lab

- **Mute mic** — supaya suara ketik peserta tidak bercampur.
- Aktif di **chat** — respond dalam 1 menit setiap pertanyaan.
- **Screen-share peserta** yang stuck (dengan izin) — mode
  "asymptotic help" (kasih hint, jangan langsung solusi).
- Pantau **kriteria sukses** — kalau > 50% peserta sudah ✅, kasih
  time-warning "5 menit lagi".

### Setelah lab

- **Debrief** 5–10 menit: "Apa yang tricky? Apa yang surprise?"
- Show **canonical solution** — buka di layar Anda + tunjuk DB state
  (audit log entry, expense status, dll) sebagai bukti sukses.
- Jangan lupa reset state kalau lab berikut butuh clean start (misal
  Lab 4 setelah Lab 3 — reset budget balance).

## Handling kondisi khusus

### Peserta stuck > 20 menit

**Root cause categorization**:

1. **Environment issue** (login gagal, container down) — trainer harus
   fix backend. Jangan biarkan peserta terus coba.
2. **Concept confusion** — tarik peserta ke Zoom breakout room, jelasin
   1-on-1 selama 5 menit.
3. **Wrong persona** — verify persona yang di-login tepat untuk lab.
4. **Data conflict** — cohort sebelumnya belum reset. Reset tenant
   `demo`.

### Sandbox down mid-session

Contingency plan:

1. **First 2 menit**: Cek health endpoint sandbox
   (`/api/health`). Kalau down, umumkan pause.
2. **Menit 3–5**: Trainer coba restart container / recreate. Kalau
   staging, ping admin platform Slack.
3. **Menit 5+**: Kalau tidak recover, pivot ke **screen-share demo**
   dari trainer. Peserta observe, tidak hands-on. Compensate dengan
   extended time di lab berikutnya.
4. **Menit 10+**: Kalau masih down, adjourn 30 menit + kirim link
   recording video demo pra-recorded.

Simpan **video pra-recorded** setiap lab sebagai emergency fallback.

### Peserta yang jauh lebih cepat

- Tugaskan **stretch goal** — "Silakan coba Lab 4 langkah B mode
  Month view + eksperimen drag task lintas milestone."
- Minta jadi **peer helper** — bantu peserta lain di chat.

### Peserta yang jauh lebih lambat

- 1-on-1 breakout room, walk through slower.
- Setelah training, kirim **recording** sesi untuk review.
- Kalau > 40% cohort lambat → adjust pace whole cohort, bukan
  individual.

### Peserta yang skeptis / challenging

Beberapa peserta dari tenant besar mungkin membanding dengan tools
lain (SAP, Oracle, custom internal). Handling:

- **Acknowledge** — "Betul, tool X juga punya feature ini. Bedanya di
  ControlDesk adalah ..." (fokus differentiator: multi-tenant native,
  Indonesian compliance built-in, RBAC granular).
- **Jangan defensif** — kalau memang ControlDesk belum punya feature
  X, jujur bilang "belum, di roadmap Fase 4+".
- **Redirect ke value** — "untuk kebutuhan `bisnis mereka`, ini yang
  sudah delivered dan ini kenapa cocok".

## Assessment day

Lihat [`evaluation.md`](evaluation.md) untuk rubric detail. Peran
trainer di assessment day:

- **Proctor** — pastikan peserta kerja individu (untuk quiz).
- **Grader** — nilai hands-on scenario dengan rubric objektif.
- **Feedback provider** — sesi 1-on-1 15 menit per peserta untuk
  feedback konstruktif.

Jadwal assessment day (recommended 3–7 hari setelah training terakhir):

```
[09:00–10:00]  Quiz tertulis (25 soal, MC + isian singkat)
[10:00–10:15]  Break
[10:15–11:45]  Hands-on scenario (per role)
[11:45–13:00]  Lunch + grading
[13:00–15:00]  1-on-1 feedback (15 menit × peserta)
[15:00–15:30]  Closing + certificate distribution
```

## Post-training clean-up

### Sandbox

- [ ] Rotate password universal — sandbox training tidak boleh terus
      pakai `ControlDesk#2026` setelah training. Follow
      [`../ops/secret-rotation.md`](../ops/secret-rotation.md).
- [ ] Purge test data yang peserta bikin — trigger `pnpm db:reset`.
- [ ] Revoke portal user demo kalau tidak diperlukan cohort berikut.

### Data

- [ ] Hapus semua screenshot peserta yang berisi PII (kalau ada).
- [ ] Anonymize contoh case study kalau akan dishare ulang.

### Feedback loop

- [ ] Kirim **survei kepuasan** ke peserta H+1 (Net Promoter Score +
      3 pertanyaan kualitatif).
- [ ] Debrief internal dengan tim training — apa yang perlu di-tune
      untuk cohort berikutnya.
- [ ] Buka PR untuk update `docs/training/*` kalau ada materi yang
      perlu di-refine.

## Pelaporan akhir

Kirim laporan ke Program Manager tenant + Product ControlDesk dalam
7 hari kerja. Template:

```markdown
# Laporan Training ControlDesk — Cohort <nama> <tanggal>

## Ringkasan eksekutif
- Peserta terdaftar: N
- Peserta hadir: M (X% attendance)
- Lulus assessment: L (Y% pass rate)

## Sesi & durasi
<table sesi × durasi × attendance>

## Assessment scores
<distribusi skor per role track>

## Highlights
- <2-3 momen positif — engagement tinggi, insight peserta>

## Issues encountered
- <bug sandbox, materi yang perlu di-tune, dll>

## Rekomendasi
- <untuk cohort berikutnya>
- <untuk product team ControlDesk (feature gap yang ditunjuk peserta)>

## Follow-up
- <30-day competency check dijadwalkan kapan>
```

## Kompetensi minimum trainer

Trainer sendiri harus lulus:

- [ ] Bisa menyelesaikan **semua 12 lab** tanpa referensi.
- [ ] Bisa menjelaskan **PDP/PEP/RLS** dengan bahasa awam.
- [ ] Bisa menyebut **threshold approval 3-tier** untuk expense
      tanpa lihat catatan.
- [ ] Bisa **membangun sandbox from scratch** (opsi B) dalam 30
      menit.
- [ ] Bisa **audit log walkthrough** — baca event + hubungkan ke
      Server Action file.

Kalau belum lulus → shadow trainer senior 1 cohort dulu sebagai
co-facilitator sebelum menjadi lead trainer.

## Kontak

- Materi + roadmap: `product@controldesk.app`.
- Bug repo docs: file issue di GitHub label `docs/training`.
- Sandbox down: `ops@controldesk.app` atau Slack `#controldesk-ops`.
