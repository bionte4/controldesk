# ControlDesk Training Curriculum

Silabus resmi program training ControlDesk. Enam sesi kelas + 12 lab
praktik ([`hands-on-labs.md`](hands-on-labs.md)). Sesi kelas fokus ke
**konsep + demo**; lab fokus ke **muscle memory + verifikasi**.

Baca overview program dulu di [`README.md`](README.md) — di sini
adalah materi mentahnya.

## Bagaimana silabus ini disusun

Setiap sesi punya struktur konsisten (adopsi framework Diátaxis
"tutorial" + "explanation" digabung):

1. **Learning objectives** — outcome terukur setelah sesi.
2. **Prasyarat** — sesi lain / bacaan yang harus done dulu.
3. **Outline** — 60/90/120 menit dipecah blok 15–20 menit.
4. **Kunci konsep** — 3–5 konsep inti yang wajib peserta bisa jelaskan.
5. **Demo** — apa yang trainer show live.
6. **Lab tautan** — mana lab di
   [`hands-on-labs.md`](hands-on-labs.md) yang paired.
7. **Rujukan doc** — link ke doc production untuk baca mandiri.

## Sesi 1 (S1) — Foundation

**Durasi**: 90 menit · **Track**: Semua (T0 wajib untuk T1–T4).

### Learning objectives

Setelah S1 peserta bisa:

- Menjelaskan model **multi-tenant** ControlDesk dan kenapa RLS penting.
- Menyebut 7 role canonical (`EMPLOYEE`, `SUPERVISOR`, `PM`, `OM`,
  `FINANCE`, `DIRECTOR`, `ADMIN`) + 1 portal (`CLIENT`), dan bilang
  role apa yang harusnya dipakai untuk skenario tertentu.
- Login ke sandbox + toggle bahasa + buka Command Palette.
- Menavigasi topbar (bell, tema, bahasa, profile) dan sidebar.
- Membaca sebuah **audit log entry** dari `security_audit_logs`.

### Prasyarat

- [`README.md`](README.md) sudah dibaca.
- Peserta punya email + password sementara.

### Outline (90 menit)

| Menit  | Topik                                                   | Format                    |
| ------ | ------------------------------------------------------- | ------------------------- |
| 0–10   | Welcome + agenda + kenalan peserta                      | Ice-breaker               |
| 10–25  | Apa itu ControlDesk (business context, personas)        | Slides + narrative        |
| 25–45  | Multi-tenant + RLS + role canonical                     | Whiteboard + slides       |
| 45–65  | Live login + tour UI (Command Palette, bell, tema, ln)  | Screen share demo         |
| 65–80  | Baca satu audit log — "siapa approve apa, kapan"        | Screen share demo         |
| 80–90  | Q&A + prep untuk sesi berikut                           | Diskusi                   |

### Kunci konsep

1. **Tenant isolation** — data satu tenant tidak boleh terlihat tenant
   lain. Semua tabel `tenant_id NOT NULL` + RLS enforce di DB.
2. **Role canonical vs legacy** — 7 canonical (baru) di layer app;
   10 legacy (lama) masih di enum DB sampai Fase 0 selesai. Peserta
   pakai canonical name.
3. **PDP + PEP + RLS = 3 lapis benteng** — server action check PEP,
   PDP decide, RLS guard. Kalau salah satu block, denial.
4. **Audit trail** — setiap mutasi sensitif direkam di
   `security_audit_logs`. Immutable (INSERT-only).
5. **i18n first** — semua string user-facing di `messages/{id,en}.json`.

### Demo (trainer)

- Login sebagai **Ayu Admin** (`admin@demo.controldesk.app`).
- Show 3 tenant slug (`demo`, `nusa`, `indo`) yang beda subdomain →
  data tidak bocor lintas tenant.
- Command Palette (`Cmd+K`): jump ke `Users`, `Projects`, `Audit log`.
- Buka satu audit log entry expense yang di-approve — tunjuk kolom
  `actor_id`, `action_type`, `old_values`, `new_values`.

### Lab paired

- **Lab 1** — Login + navigasi + toggle bahasa/tema.
- **Lab 2** — Baca audit log 1 event.

### Rujukan doc

- [`../product/overview.md`](../product/overview.md)
- [`../product/roles-and-permissions.md`](../product/roles-and-permissions.md)
- [`../architecture.md`](../architecture.md) — untuk yang penasaran ke tech.

---

## Sesi 2 (S2) — Client, Project, WBS & Gantt

**Durasi**: 90 menit · **Track**: T1 · T2 (Operator + Delivery).

### Learning objectives

Setelah S2 peserta bisa:

- Membuat **client** baru + **project** baru (kalau role
  mengizinkan) dan menautkan.
- Menulis milestone + WBS task (Level 2+) dengan owner, dependency,
  planned dates.
- Mem-buka **Gantt view**, drag task horizontal untuk reschedule,
  drag progress handle untuk update progress.
- Menjelaskan kenapa **milestone** dan **WBS task** hidup berdampingan
  (bukan saling menggantikan).

### Prasyarat

- S1 done.
- Persona **Putri PM** atau **Omar Operations** tersedia di sandbox.

### Outline (90 menit)

| Menit  | Topik                                                                                      |
| ------ | ------------------------------------------------------------------------------------------ |
| 0–10   | Recap: multi-tenant + role                                                                 |
| 10–25  | Client master (1 client → N projects) + status project lifecycle                           |
| 25–45  | Milestone (Level 1 phase gate) — kapan pakai vs WBS?                                       |
| 45–70  | WBS + Gantt walkthrough — hierarki, rollup progress, dependency, drag-to-reschedule        |
| 70–85  | Live demo: bikin project + 2 milestone + 5 task + buka Gantt                               |
| 85–90  | Q&A                                                                                        |

### Kunci konsep

1. **Client → 1:N Projects** — bukan 1:1. Klien besar bisa punya proyek
   ganda paralel.
2. **Milestone = kalender gate** — misal Kickoff, UAT, Go-Live. Punya
   notifikasi otomatis ke Client Portal saat status berubah.
3. **WBS Task = eksekusi hierarkis** — di bawah milestone. Progress
   rollup weighted-average dari leaf ke root (dihitung on-read).
4. **Gantt = visualisasi editable** — drag horizontal reschedule, drag
   progress handle 0–100. Perubahan langsung nyimpan via Server Action.
5. **Dependency = finish-to-start** — sekarang single predecessor per
   task. Cycle-guard di server.

### Demo (trainer)

- Login sebagai **Omar Operations**.
- `/clients` → New client "PT Contoh Sejahtera" (industri Retail).
- Klik client → Add project "Retail POS Rollout Batch 3".
- Buka project → Milestones tab → tambah "Kickoff" (10 Jul), "UAT"
  (20 Aug), "Go-Live" (30 Aug).
- Ganti login ke **Putri PM** — buka project yang sama.
- Section **Tasks** → New task "Requirements gathering" (planned
  Jul 10–Jul 20, owner: Eko Employee, anchor ke milestone Kickoff).
- Add 2 sub-task di bawah "Requirements": "Interview stakeholder",
  "Draft SRS".
- Klik tab **Gantt Chart** → tunjuk dua sub-task muncul di bawah
  parent. Drag "Draft SRS" ke kanan 3 hari → status
  `planned_end_date` update.
- Drag progress handle "Interview stakeholder" ke 50% → parent
  "Requirements" `rolled_progress` naik ke 25% (weighted avg).

### Lab paired

- **Lab 3** — Client + Project bootstrap.
- **Lab 4** — Build WBS + Gantt.

### Rujukan doc

- [`../modules/projects.md`](../modules/projects.md) — schema + state
  machines + WBS deep-dive.
- [`../modules/clients-and-portal.md`](../modules/clients-and-portal.md).

---

## Sesi 3 (S3) — Finance & Approval Chains

**Durasi**: 120 menit · **Track**: T2 · T3 (Delivery + Finance).

### Learning objectives

Setelah S3 peserta bisa:

- Menyubmit dan memahami alur **Expense**, **Cash Advance General**,
  **Cash Advance Field Ops**, **Petty Cash**, **Budget Request**.
- Membaca threshold approval + tahu siapa approver di setiap tier.
- Menjalankan approval sebagai approver (approve / reject / minta
  klarifikasi).
- Meng-settle Cash Advance (refund + reimbursement top-up).

### Prasyarat

- S1 done. S2 disarankan (context project).
- Persona **Eko Employee** + **Sinta Supervisor** + **Putri PM** +
  **Fajar Finance** + **Gita General** semua di sandbox.

### Outline (120 menit)

| Menit    | Topik                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| 0–10     | Recap S2 (opsional)                                                              |
| 10–30    | Threshold matrix (§9) — Expense / CA General / CA Field Ops / Petty Cash / BR    |
| 30–50    | Expense flow end-to-end — submit → PM → Finance → paid                           |
| 50–75    | Cash Advance General & Field Ops — kenapa dua chain terpisah?                    |
| 75–95    | Petty Cash — imprest fund + reconciliation                                       |
| 95–110   | Budget Request — Increase / Decrease / Transfer                                  |
| 110–120  | Q&A + prep lab                                                                   |

### Kunci konsep

1. **3-tier threshold** — `< 5M` Finance-only, `5M–50M` PM+Finance,
   `≥ 50M` PM+Finance+Director.
2. **Finance = parallel gate** — bisa jalan bareng PM (bukan harus
   tunggu PM dulu). UI tampil sebagai timeline slot.
3. **Field Ops CA** — chain berbeda karena melibatkan Supervisor
   (validasi lapangan) selalu di rung 0.
4. **Petty Cash imprest** — `< 200K` auto-approve; `200K–2M` Finance
   approve; `> 2M` dilarang di petty cash, harus lewat Expense.
5. **Settlement bukan approval** — settlement adalah reconciliation
   antara advance vs actual receipt. Refund atau reimbursement top-up.

### Demo (trainer)

- Login **Eko Employee** → Expense IDR 4.5M ("Beli parts server").
  → Chain: Finance-only.
- Ganti ke **Fajar Finance** → approve → status `Paid`.
- Login **Sinta Supervisor** → Field Ops CA IDR 3M ("Site visit
  Bandung"). Chain: Supervisor → Finance.
- Ganti ke **Eko Employee** → sama chain? Tidak — CA General IDR 3M
  langsung ke Finance karena `< 20M`.

### Lab paired

- **Lab 5** — Expense small (< 5M) end-to-end.
- **Lab 6** — Cash Advance General (Employee → PM → Finance).
- **Lab 7** — Cash Advance Field Ops (Sinta → Fajar).
- **Lab 8** — Petty Cash spend + reconciliation.

### Rujukan doc

- [`../product/approval-workflows.md`](../product/approval-workflows.md)
  — kanonik untuk threshold + chain.
- [`../modules/finance.md`](../modules/finance.md).

---

## Sesi 4 (S4) — HR & Timesheet

**Durasi**: 90 menit · **Track**: T1 · T2 (Operator + Delivery).

### Learning objectives

Setelah S4 peserta bisa:

- Meng-input timesheet harian atau weekly packet.
- Meng-ajukan cuti / lembur / sakit lewat HR request.
- Meng-approve timesheet + HR request sebagai PM / Supervisor.
- Menjelaskan konsep **utilization** dan kenapa alokasi > 100% dilarang.

### Prasyarat

- S1 done.

### Outline (90 menit)

| Menit  | Topik                                                            |
| ------ | ---------------------------------------------------------------- |
| 0–10   | Recap                                                            |
| 10–30  | Timesheet — daily vs weekly, business hours, ISO week            |
| 30–50  | HR request — leave / OT / sick, dokumen wajib per kind           |
| 50–70  | Approval flow: Employee → Supervisor → PM → HR Admin             |
| 70–85  | Roster & shift — bukan wajib semua tenant, tapi contoh setup     |
| 85–90  | Q&A                                                              |

### Kunci konsep

1. **Weekly packet lebih efisien dari daily** — 7 entry submit
   sekaligus, 1 kali approval per week.
2. **Overtime derived** — bukan request formal, tapi dihitung dari
   `sum(entries) − 40` (di Fase 0). Formal OT request masih ada untuk
   pre-approval > 40 jam.
3. **Sick wajib upload surat dokter** — validasi di Zod, bukan opsional.
4. **Total alokasi ≤ 100%** — 1 employee di multi-project. Trigger DB
   raise `check_violation` kalau overbook.
5. **PM/Supervisor approve** — single-step, tidak ke Finance.

### Demo (trainer)

- Login **Eko Employee** → weekly packet 5 hari @ 8 jam ke project
  KIRA-DA → submit.
- Ganti **Putri PM** → approve packet → status `Approved` (auto-lock
  optional).
- Login **Eko** lagi → HR request `LEAVE` cuti tahunan 3 hari.
- Ganti **Sinta Supervisor** → approve L1.
- Ganti **Putri PM** → approve L2 → status `Approved`.

### Lab paired

- **Lab 9** — Weekly timesheet submit + approve.
- **Lab 10** — HR request cuti + approval chain.

### Rujukan doc

- [`../modules/hris-and-payroll.md`](../modules/hris-and-payroll.md).
- [`../user-guides/internal-users.md#employee`](../user-guides/internal-users.md#employee).

---

## Sesi 5 (S5) — Integrations (SMTP, WhatsApp, Telegram, AI, Calendar)

**Durasi**: 60 menit · **Track**: T4 (Admin & IT Support tenant).

### Learning objectives

Setelah S5 peserta bisa:

- Menyetup SMTP per-tenant dan **verify** sebelum save.
- Menyetup WhatsApp provider (Fonnte atau Twilio) sampai `verified`.
- Menyetup Telegram BotFather + link user via HMAC deep link.
- Menyetup AI provider (Google Gemini atau LLM lokal) + daily cap.
- Menyetup Google Calendar OAuth + cron drain.
- Melakukan **test-send** setiap channel dan membaca `notification_dispatch_logs`.

### Prasyarat

- S1 done.
- Peserta punya role `ADMIN` atau `TENANT_ADMIN` di sandbox.
- Sudah siap secret sample: dummy SMTP creds, WhatsApp API key sample,
  Gemini API key sandbox.

### Outline (60 menit)

| Menit  | Topik                                                         |
| ------ | ------------------------------------------------------------- |
| 0–5    | Overview integration hub                                      |
| 5–20   | SMTP setup + verify (nodemailer test)                         |
| 20–35  | WhatsApp (Fonnte pairing / Twilio API)                        |
| 35–45  | Telegram bot + user pairing                                   |
| 45–55  | AI provider (Gemini vs local LLM) + daily cap Redis           |
| 55–60  | Google Calendar OAuth + cron drain                            |

### Kunci konsep

1. **Per-tenant creds, encrypted at rest** — pakai `pgcrypto` +
   `APP_ENCRYPTION_KEY`. Tidak ada plaintext secret di DB.
2. **Verify-before-save** — semua integrasi punya tombol "Verify"
   yang test connection sebelum row di-mark `verified=true`.
3. **Fail-open notification** — kalau channel gagal (SMTP down,
   WhatsApp API rate limit), sistem log ke
   `notification_dispatch_logs` tapi tidak block Server Action.
4. **AI daily cap via Redis** — counter per `tenant_id` per hari.
   Kalau overshoot → return fallback response non-AI.
5. **Google Calendar outbox pattern** — Server Action tidak call
   Google langsung; enqueue ke `project_calendar_events`, drain via
   `/api/cron/google-calendar-drain`.

### Demo (trainer)

- Login **Ayu Admin** → `/settings/integrations`.
- SMTP: masukkan Mailpit local (`host=controldesk-mailpit`, port
  1025) → Verify → Save. Kirim test notification.
- WhatsApp Fonnte: masukkan device token → pair → test-send ke nomor
  demo.
- Gemini: paste API key sandbox → tampilkan token daily cap.

### Lab paired

- **Lab 11** — SMTP setup + verify + test-send.
- **Lab 12** — WhatsApp Fonnte pairing + test-send.

### Rujukan doc

- [`../integrations/README.md`](../integrations/README.md) — hub.
- [`../integrations/ai-insights-gemini.md`](../integrations/ai-insights-gemini.md).
- [`../integrations/telegram-bot.md`](../integrations/telegram-bot.md).
- [`../integrations/whatsapp-fonnte.md`](../integrations/whatsapp-fonnte.md).

---

## Sesi 6 (S6) — Admin & Governance

**Durasi**: 90 menit · **Track**: T3 · T4 (Finance + Admin).

### Learning objectives

Setelah S6 peserta bisa:

- Mengundang user internal + client portal user.
- Meng-tune threshold approval per-tenant.
- Membaca audit log filter + export.
- Menjalankan emergency override approval (dengan justification).
- Menjelaskan retention policy (7 tahun audit, 10 tahun financial).

### Prasyarat

- S1 done. S3 disarankan (context threshold).

### Outline (90 menit)

| Menit   | Topik                                                            |
| ------- | ---------------------------------------------------------------- |
| 0–15    | User management — internal invite + role assignment              |
| 15–30   | Client portal invite + reset password                            |
| 30–50   | Approval threshold admin UI — tune per tenant                    |
| 50–70   | Audit log — filter, export, retention                            |
| 70–85   | Emergency override (Director/Admin) + justification requirement  |
| 85–90   | Q&A                                                              |

### Kunci konsep

1. **Invitation flow** — Admin invite via email; user first-login
   ganti password + set 2FA (kalau tenant enable).
2. **Threshold per-tenant** — override default lewat
   `public.approval_thresholds` + `resolveThresholds()`. Constraint
   `approval_thresholds_ordered_ck` cegah `finance ≥ pm ≥ director`
   nyeleneh.
3. **Emergency override** — `DIRECTOR` bisa short-circuit chain +
   `ADMIN` bisa approve step manapun. Justification wajib ≥ 20 char.
4. **Retention** — audit log 7 tahun (kompliance keuangan),
   financial records 10 tahun (UU KUP). Anonymize (bukan delete)
   employee terminated setelah 5 tahun.
5. **Immutable audit** — INSERT-only. Tidak bisa edit/delete row lama.

### Demo (trainer)

- Login **Ayu Admin** → `/settings/users` → invite peserta baru.
- `/settings/approval-thresholds` → naikkan Finance threshold dari
  5M ke 7M (contoh) → save → tampilkan constraint check.
- `/settings/audit-log` → filter `resource=project_expenses`,
  `actor_role=FINANCE`, range 7 hari terakhir → export CSV.
- Live demo emergency override: expense pending → Ayu Admin approve
  langsung + isi justification.

### Lab paired

- **Lab 11** — Threshold config + verify constraint.

### Rujukan doc

- [`../security-model.md`](../security-model.md).
- [`../ops/data-retention.md`](../ops/data-retention.md).
- [`../product/roles-and-permissions.md`](../product/roles-and-permissions.md).

---

## Ringkasan matrix sesi × track

| Sesi                              | T1 Operator | T2 Delivery | T3 Finance | T4 Admin |
| --------------------------------- | ----------- | ----------- | ---------- | -------- |
| S1 Foundation                     | ✅ Wajib    | ✅ Wajib    | ✅ Wajib   | ✅ Wajib |
| S2 Client & Project & WBS         | ✅          | ✅          | Optional   | Optional |
| S3 Finance & Approval             | Optional    | ✅          | ✅         | Optional |
| S4 HR & Timesheet                 | ✅          | ✅          | Optional   | Optional |
| S5 Integrations                   | Skip        | Skip        | Optional   | ✅       |
| S6 Admin & Governance             | Skip        | Optional    | ✅         | ✅       |

**Total durasi per track**:

- T1: 90 + 90 + 90 = **270 menit (4.5 jam)**
- T2: 90 + 90 + 120 + 90 = **390 menit (6.5 jam)**
- T3: 90 + 120 + 90 = **300 menit (5 jam)**
- T4: 90 + 60 + 90 = **240 menit (4 jam)**

Tambah 60–120 menit lab per hari + break → alokasi realistis
**2 hari kerja** untuk track penuh manapun.

## Materi ekstra (optional deep-dive)

Untuk peserta advance / trainer sendiri:

- [`../architecture.md`](../architecture.md) — arsitektur teknis.
- [`../security-model.md`](../security-model.md) — PDP + PEP + RLS
  detail.
- [`../qa/e2e-roleplay.md`](../qa/e2e-roleplay.md) — 11 persona +
  cross-role chain scenarios.
- [`../reference/database-schema.md`](../reference/database-schema.md) —
  ERD + migration timeline.
