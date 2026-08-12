# ControlDesk Training Evaluation & Assessment

Rubrik lengkap untuk menilai kompetensi peserta program training
ControlDesk. Doc ini menjawab: **"peserta lulus atau tidak? kenapa?
apa follow-up-nya?"**

Baca [`README.md`](README.md), [`curriculum.md`](curriculum.md), dan
[`hands-on-labs.md`](hands-on-labs.md) dulu sebagai konteks.

## Format assessment

Total penilaian per peserta = **100 poin**, bagi ke 3 komponen:

| Komponen                    | Bobot | Format                                             |
| --------------------------- | ----- | -------------------------------------------------- |
| **Lab completion**          | 30%   | Auto-tracked — kriteria sukses ✅ di setiap lab   |
| **Quiz tertulis**           | 30%   | 25 soal (MC + isian singkat), waktu 60 menit      |
| **Hands-on scenario**       | 40%   | Kasus real, 90 menit, dinilai dengan rubric       |

**Lulus threshold**: total ≥ **70 poin** dan komponen manapun ≥ 50%
minimum (tidak boleh 0 di satu komponen dan compensate di komponen
lain).

## Distribusi nilai per role track

Assessment dibedakan per track — peserta hanya dinilai untuk lab &
skenario yang relevan role-nya.

| Track                | Lab yang dinilai        | Quiz soal | Scenario                                              |
| -------------------- | ----------------------- | --------- | ----------------------------------------------------- |
| T1 Operator          | 1, 2, 4, 5, 7, 9, 10    | 20 core   | Weekly timesheet + HR request + Expense small        |
| T2 Delivery          | 1, 2, 3, 4, 6, 7, 10    | 25 core + PM | Bikin project + WBS + approve chain 8M              |
| T3 Finance           | 1, 2, 5, 6, 7, 8        | 25 core + Finance | Finance approve + disburse + petty cash recon    |
| T4 Admin             | 1, 2, 11, 12            | 20 core + Admin | Setup SMTP + WhatsApp + threshold tuning         |

## Quiz tertulis — 25 soal

Waktu: **60 menit**, **open book** (peserta boleh buka
`docs/user-guides/` dan `docs/product/` — tidak boleh buka lab
answer key).

**Struktur**:

- Soal 1–10 (core, 20 poin): pilihan ganda × 2 poin.
- Soal 11–20 (role-specific, 15 poin): MC atau isian singkat × 1.5 poin.
- Soal 21–25 (open-ended, 15 poin): jawaban 2–4 kalimat × 3 poin.

### Contoh soal core (semua track)

**Soal 1 (MC)** — Data satu tenant di ControlDesk tidak boleh terlihat
tenant lain. Mekanisme utama yang menjamin ini di layer database
adalah:

- (a) Foreign key constraint.
- (b) Row Level Security (RLS) policy.
- (c) Middleware Next.js.
- (d) Server Action authorization.

**Jawaban**: (b). RLS adalah benteng terakhir; server action dan
middleware adalah PEP di atas.

---

**Soal 2 (MC)** — Password sementara peserta training adalah:

- (a) `admin123`.
- (b) `password`.
- (c) `ControlDesk#2026`.
- (d) diberikan oleh tenant admin masing-masing.

**Jawaban**: (c) untuk sandbox training. Di production tenant, (d)
via invitation.

---

**Soal 3 (MC)** — Role canonical berikut boleh membuat WBS task,
kecuali:

- (a) `PM`.
- (b) `SUPERVISOR`.
- (c) `OM`.
- (d) `EMPLOYEE`.

**Jawaban**: (d). `SUPERVISOR`, `PM`, `OM`, `DIRECTOR`, `ADMIN` boleh
create; `EMPLOYEE` tidak boleh (bisa view saja).

---

**Soal 4 (Isian singkat)** — Sebutkan 3 field yang WAJIB dicatat di
`security_audit_logs` setiap mutasi data sensitif.

**Jawaban** (any 3): `tenant_id`, `actor_id`, `action_type`,
`resource_name`, `old_values`, `new_values`, `ip_address`,
`user_agent`, `created_at`.

---

**Soal 5 (MC)** — Employee Eko submit expense `IDR 12.500.000`.
Approval chain untuk expense ini adalah:

- (a) Finance only.
- (b) PM → Finance.
- (c) PM → Finance → Director.
- (d) Supervisor → PM → Finance.

**Jawaban**: (b). Tier 5M ≤ amount < 50M butuh PM + Finance.

### Contoh soal role-specific

**Track T2 — PM/OM (Soal 11)** — Kalau Anda drag task di Gantt chart
horizontal ke kanan 3 hari, field database yang berubah adalah:

- (a) `actual_start_date` + `actual_end_date`.
- (b) `planned_start_date` + `planned_end_date`.
- (c) `depends_on_task_id`.
- (d) `sort_order`.

**Jawaban**: (b).

---

**Track T3 — Finance (Soal 11)** — Petty cash spend maksimum yang
boleh diproses via petty cash flow adalah:

- (a) IDR 200.000.
- (b) IDR 2.000.000.
- (c) IDR 5.000.000.
- (d) IDR 20.000.000.

**Jawaban**: (b). > IDR 2M harus lewat Expense flow.

---

**Track T4 — Admin (Soal 11)** — Ketika Anda save konfigurasi SMTP
per-tenant, password disimpan di database dalam bentuk:

- (a) plain text (untuk debug).
- (b) hashed dengan bcrypt.
- (c) encrypted dengan pgcrypto pakai `APP_ENCRYPTION_KEY`.
- (d) tidak disimpan, hanya di memory.

**Jawaban**: (c).

### Contoh soal open-ended

**Soal 21** — Jelaskan dalam 2–4 kalimat: kenapa Cash Advance Field
Ops selalu punya Supervisor di rung 0, sementara Cash Advance General
tidak?

**Kunci jawaban**: Field Ops CA melibatkan visit site fisik dengan
biaya operasional (bensin, toll, parkir). Supervisor punya visibility
lapangan yang PM di kantor tidak punya — dia yang confirm insiden
memang perlu site visit, RAB masuk akal untuk lokasi, dan bahwa Field
Engineer memang berangkat. Kalau tanpa Supervisor, chain jadi trust
Employee 100% pada RAB yang di-submit, yang berbahaya untuk fraud
risk field ops.

**Rubric grading**:

- 3 poin: menyebut *validasi lapangan* + *fraud risk* + contoh
  konkret.
- 2 poin: menyebut *validasi lapangan* saja.
- 1 poin: menyebut fakta chain tanpa penjelasan sebab.
- 0 poin: tidak jawab / salah kirim.

## Hands-on scenario

Setiap peserta dapat **scenario 90 menit** yang relevan role-nya. Ini
lebih realistis dari lab — ada twist / edge case + peserta harus tahu
kapan minta bantuan dan kapan proceed.

Peserta di-**observe langsung** oleh trainer (in-person atau screen
share). Trainer catat setiap keputusan + waktu selesai per step.

### Scenario T1 Operator

**Setup**: Eko Employee, sandbox segar.

**Task**:
1. Submit weekly timesheet minggu lalu (5 hari × 8 jam) ke project
   KIRA-DA.
2. Ajukan cuti tahunan 3 hari mulai hari ini + 14 hari.
3. Submit Expense untuk beli 20 flash drive `IDR 750.000` (dengan
   receipt scan).
4. Submit Cash Advance Field Ops untuk site visit `IDR 4.200.000`.
5. Cek status semua submission di dashboard Anda.

**Twist**: Sistem awalnya reject cuti karena overlap dengan cuti
lain — peserta harus adjust tanggal.

**Rubric** (40 poin):

- ✅ Timesheet submit tanpa error, project & hours benar — 8 poin.
- ✅ Cuti submit + resolve conflict tanggal — 8 poin.
- ✅ Expense submit dengan receipt attach — 8 poin.
- ✅ Field Ops CA dengan RAB lengkap ≥ 3 line items — 8 poin.
- ✅ Dashboard menunjukkan status yang tepat — 4 poin.
- ✅ Selesai dalam 90 menit — 4 poin (kurang = poin proporsional).

### Scenario T2 Delivery

**Setup**: Putri PM, sandbox segar.

**Task**:
1. Buat client baru "PT Mega Nusantara" (Manufacturing).
2. Buat project "MES Rollout Q3" dengan budget IDR 350M.
3. Assign 1 PM (Putri) + 3 employee dengan alokasi tepat (tidak
   overbook).
4. Bikin 4 milestone (Kickoff, Design UAT, Prod UAT, Go-Live).
5. Bikin minimal 10 WBS task dengan 2 level nesting + dependency.
6. Approve 1 expense IDR 8M yang di-submit peserta lain.
7. Approve 1 weekly timesheet packet.
8. Buka Gantt view, drag 1 task, verify persist.

**Twist**: Salah satu employee sudah 90% alokasi di project lain —
peserta harus notice dan turunkan alokasi ke 10% atau pilih lain.

**Rubric** (40 poin):

- ✅ Client + project create dengan data valid — 5 poin.
- ✅ Assignment tanpa overbook — 5 poin (deduct 3 kalau overbook).
- ✅ 4 milestone dengan tanggal sensible — 4 poin.
- ✅ WBS ≥ 10 task, 2 level, ≥ 1 dependency — 8 poin.
- ✅ Approve expense chain sesuai — 5 poin.
- ✅ Approve timesheet — 4 poin.
- ✅ Gantt drag + persist — 5 poin.
- ✅ Selesai dalam 90 menit — 4 poin.

### Scenario T3 Finance

**Setup**: Fajar Finance, seed dengan pending approvals.

**Task**:
1. Review 5 pending expense + approve/reject dengan komentar.
2. Approve + disburse 2 pending Cash Advance.
3. Finalize 1 Cash Advance settlement (dengan refund IDR 250K).
4. Approve 1 Budget Request (increase).
5. Trigger 1 petty cash replenishment.
6. Audit: filter audit log 24 jam terakhir, identify anomaly (kalau
   ada).

**Twist**: 1 expense punya receipt yang tidak match amount (deliberate
mismatch) — peserta harus reject dengan reason.

**Rubric** (40 poin):

- ✅ 5 expense reviewed dengan keputusan konsisten — 8 poin.
- ✅ Reject expense mismatch dengan reason jelas — 4 poin.
- ✅ 2 CA approve + disburse — 6 poin.
- ✅ Settlement finalize dengan refund — 6 poin.
- ✅ BR approve + apply — 5 poin.
- ✅ Petty cash replenishment — 4 poin.
- ✅ Audit log walkthrough dengan insight — 4 poin.
- ✅ Selesai dalam 90 menit — 3 poin.

### Scenario T4 Admin

**Setup**: Ayu Admin, sandbox baru.

**Task**:
1. Invite 3 user internal (1 employee, 1 supervisor, 1 PM) via email.
2. Setup SMTP + verify + kirim test email.
3. Setup WhatsApp provider (Fonnte atau Twilio) + verify.
4. Setup AI provider Gemini + set daily cap 5000 tokens.
5. Naikkan Expense PM threshold dari 5M ke 7M via approval
   thresholds admin.
6. Invite 1 client portal user + trigger reset password.
7. Buka audit log filter `resource=tenant_smtp_configs` — verify
   audit yang Anda barusan bikin muncul.

**Twist**: Threshold constraint gagal karena Anda coba naikkan PM di
atas Director threshold (mock). Peserta harus notice + adjust.

**Rubric** (40 poin):

- ✅ 3 user internal invited + status pending — 6 poin.
- ✅ SMTP verified + test email masuk Mailpit — 6 poin.
- ✅ WA verified — 6 poin.
- ✅ AI daily cap set benar — 4 poin.
- ✅ Threshold naik + constraint notice — 6 poin.
- ✅ Client portal invite + reset password kirim email — 5 poin.
- ✅ Audit log filter benar + verify entry — 4 poin.
- ✅ Selesai dalam 90 menit — 3 poin.

## Kompetensi checklist (30-day check)

Setelah 30 hari peserta bekerja di production tenant, trainer + Program
Manager review via `security_audit_logs`:

| Kriteria                                                                      | Target       |
| ----------------------------------------------------------------------------- | ------------ |
| Peserta login production ≥ 5 kali/minggu                                      | ✅          |
| Peserta menyelesaikan aksi role-nya (submit / approve / dst) tanpa error    | ≥ 90%        |
| Peserta bertanya support / eskalasi Tenant Admin                            | ≤ 2×/minggu  |
| Peserta trigger error 500 / RLS denial di sisi produksi                     | ≤ 1×/minggu  |
| Peserta submit doc bug via [`../qa/bug-reporting.md`](../qa/bug-reporting.md)| ≥ 0 (bagus kalau ada) |

Peserta yang **tidak** memenuhi target → recommend **refresher
training** 1-day untuk sesi/lab yang gagal.

## Sertifikat

Peserta lulus dapat sertifikat digital (PDF) dengan template
`docs/training/certificate-template.pdf` (planned). Isi:

- Nama peserta.
- Track (T1/T2/T3/T4).
- Skor total.
- Tanggal training.
- Signature trainer + Program Manager.
- Verification link ke `security_audit_logs` audit trail training.

Sertifikat **berlaku 12 bulan** — setelah itu wajib refresher, karena
platform berevolusi (fitur baru, threshold berubah, integrasi baru).

## Failure handling

Peserta yang **tidak lulus** (< 70 total):

1. **Feedback session** 30 menit — trainer + peserta review area yang
   gagal.
2. **Study plan** — trainer suggest doc mana yang mendalami area
   tersebut.
3. **Retake** — peserta boleh retake assessment setelah minimal
   2 minggu study. Maksimal 3 kali retake dalam 6 bulan.
4. **Access** — peserta tetap dapat production access, tapi
   Tenant Admin diberitahu bahwa peserta butuh close-supervision di
   role-nya selama 30 hari.

Peserta yang **gagal 3× retake** → recommend re-training penuh
program atau assign role yang lebih rendah.

## Reporting template

Trainer mengumpulkan hasil dalam Google Sheet / Notion table:

| Peserta   | Track | Quiz | Lab % | Scenario | Total | Lulus | Note      |
| --------- | ----- | ---- | ----- | -------- | ----- | ----- | --------- |
| Bapak A   | T2    | 25   | 90    | 34       | 82    | ✅    | Baik      |
| Ibu B     | T1    | 18   | 100   | 28       | 71    | ✅    | Pas       |
| Bapak C   | T4    | 22   | 80    | 20       | 62    | ❌    | Refresher |

Aggregate ke [Pelaporan
akhir](facilitator-guide.md#pelaporan-akhir).

## Continuous improvement

Setiap cohort trainer submit **retrospective**:

- Soal quiz yang > 60% peserta salah → soal ambigu atau materi kurang.
  Tune sesi atau ganti soal.
- Lab yang > 50% peserta gagal → lab terlalu sulit atau instruksi tidak
  jelas. Refine di PR.
- Scenario yang selesai < 60 menit rata-rata → naikkan complexity.
  Yang > 90 menit → sederhanakan.

Simpan metrics di
[`../qa/test-catalog.md#training-metrics`](../qa/test-catalog.md) atau
Notion database `Training Cohorts`.
