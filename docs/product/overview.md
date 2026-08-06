# Product overview

**ControlDesk** adalah platform ERP multi-tenant khusus untuk perusahaan
**BPO (Business Process Outsourcing) / Managed Services** di Indonesia.
Satu instans meng-host banyak perusahaan sekaligus — setiap perusahaan
mendapat subdomain sendiri (`{slug}.controldesk.app`) dengan isolasi data
level Postgres RLS.

Fokus utama: menggantikan spreadsheet + WhatsApp + Google Apps Script yang
dipakai tim BPO untuk mengelola **proyek**, **anggaran**, **kas kecil**,
**timesheet**, dan **cuti/lembur** — dengan single source of truth yang
punya jejak audit lengkap, alur persetujuan otomatis, dan portal
transparansi untuk klien.

## Who it's for

### Primary personas

| Persona                     | Role di sistem                             | Kebutuhan utama                                                   |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| **Karyawan lapangan**       | `EMPLOYEE`                                 | Isi timesheet, ajukan cuti/lembur/sakit, submit nota struk.       |
| **Supervisor lapangan**     | `SUPERVISOR`                               | Validasi kehadiran + nota tim, approve L1 pengeluaran + kas bon.  |
| **Project Manager**         | `PROJECT_MANAGER` (canonical: `PM`)        | Kelola proyek + tim, approve L2, cek margin proyek.               |
| **Operations Manager**      | `OPERATIONS_MANAGER` (canonical: `OM`)     | Awasi beberapa PM, approve L3, alokasi resource lintas proyek.    |
| **Head/General Manager**    | `HEAD_MANAGER` / `GENERAL_MANAGER` (canonical: `DIRECTOR`) | Approve L4/L5 (nominal besar), monitor P&L per klien.             |
| **Lead Finance**            | `LEAD_FINANCE` (canonical: `FINANCE`)      | Gerbang cashflow — validasi nota, cair kas bon, replenish kas kecil, tutup buku bulanan. |
| **Petty Cash Custodian**    | `PETTY_CASH_CUSTODIAN` (canonical: `FINANCE`) | Kelola kas kecil harian, rekonsiliasi voucher, ajukan top-up.     |
| **HR Admin**                | `HR_ADMIN` (canonical: `ADMIN`)            | Kelola master karyawan, finalisasi cuti/sakit, jalankan payroll.  |
| **Tenant Admin**            | `TENANT_ADMIN` (canonical: `ADMIN`)        | Konfigurasi perusahaan, invite user, kelola secrets & retention.  |
| **External Client User**    | `CLIENT` (external portal)                 | Lihat progress proyek, milestone, dan financial summary via `/portal`. |

Detail matriks kapabilitas → [`roles-and-permissions.md`](roles-and-permissions.md).

### Secondary personas

- **AI / Analyst** — mengonsumsi output `ai_insights` (predictive expense,
  resource utilization, client health, SLA breach risk) di dashboard
  eksekutif.
- **Auditor internal / eksternal (PPh, PPN)** — melihat immutable audit
  trail `security_audit_logs` (retensi 7 tahun) + cold archive
  registry di `/settings/archives`.
- **On-call engineer** — mengonsumsi log JSON terstruktur + Sentry/Axiom
  sink + runbook di [`docs/ops/`](../ops/).

## Feature matrix

Yang sudah **landed di kodebase** (tidak ada placeholder — semua bisa
dites di seeded demo tenant):

### Client & project management
- [x] Client master (1 client → banyak proyek), tipe kontrak (One-off, Retainer, Managed Services BPO).
- [x] BPO contracts + SLA commitments dengan penalty tracking.
- [x] Projects dengan status DRAFT → PLANNED → ACTIVE → COMPLETED → CANCELLED, budget total, alokasi PM & karyawan.
- [x] Project PM assignments (PRIMARY_PM, CO_PM).
- [x] Project employee assignments dengan `allocation_percentage` — enforcement total ≤ 100% lintas proyek aktif.
- [x] **PM Handover** — serah terima proyek antar PM dengan approval OM + HM/GM, otomatis transfer pending approvals.
- [x] **Project Issues** — tracker isu proyek dengan **SLA business-hours** (Critical 1h, High 4h, Medium 8h, Low 24h) + **auto-escalation** Supervisor → PM → OM → Director tiap sweep 15 menit.
- [x] Progress milestones per proyek dengan status DONE / AT_RISK / CANCELLED.

### Finance
- [x] **Project Expenses** — pengajuan biaya proyek dengan approval chain berbasis nominal.
- [x] **Budget & Budget Details** — anggaran proyek per kategori (Direct Labor, Operational, Sub-contract, dst).
- [x] **Budget Requests** — permintaan Increase / Decrease / Transfer anggaran dengan state machine sendiri (DRAFT → PENDING_PM? → PENDING_FINANCE → PENDING_DIRECTOR? → APPROVED → APPLIED).
- [x] **Cash Advance** dua varian:
  - **General** (kas bon umum) — thresholds PM `Rp2jt` / Director `Rp20jt`.
  - **Field Ops** (kas bon lapangan) — thresholds Supervisor → PM `Rp5jt` → OM `Rp20jt` → Director `Rp50jt`, dengan **settlement SLA 10 hari** + auto-reminder di hari -3, 0, +1, +3, +7.
- [x] **Petty Cash** (Imprest Fund) — auto-approve < `Rp200rb`, receipt required ≥ `Rp100rb`, hard ceiling `Rp2jt` (di atas itu redirect ke expense flow), low-balance ratio 20%, reconciliation overdue 3 hari, variance tolerance `Rp5rb`.
- [x] **Unified Approvals Inbox** (`/approvals`) — satu tempat untuk supervisor / PM / OM / director / finance melihat semua item pending, dengan realtime refresh via Supabase Realtime.

### HRIS
- [x] Employee master dengan atribut sensitif (salary, KTP, NPWP, bank account) di-encrypt via `pgcrypto` + `APP_ENCRYPTION_KEY`.
- [x] **Work shifts** (24/7, cross-midnight, night shift, weekend allowance).
- [x] **Employee rosters** — assignment karyawan ke shift + tanggal.
- [x] **HR Requests** tiga jenis dengan approval chain berbeda:
  - **Leave / Overtime** — Supervisor (L1) → PM (L2) → OM (L3) → HR Admin (Final).
  - **Sick** — Supervisor (L1) → HR Admin (Final) — dengan surat dokter wajib.
- [x] **Timesheets** dua mode:
  - **Daily** — entry per hari per karyawan.
  - **Weekly packet** — submission ISO-8601 Monday-to-Sunday, approval PM per packet.
- [x] **Payroll** — Direct Labor Cost calc: `hours_worked × hourly_rate + hours_overtime × hourly_rate × OVERTIME_MULTIPLIER`, dengan **provenance tracking** (weekly-approved vs daily-only) untuk audit.

### Client Portal (external surface)
- [x] Login terpisah di `/portal/login` dengan `client_users` table (bukan `auth.users`), password hash `scrypt`, opaque session tokens.
- [x] **Force change password** untuk user baru (status `PENDING_ACTIVATION`).
- [x] Dashboard klien — daftar proyek aktif, progress, milestones.
- [x] Project detail — timeline milestone + financial summary (budget utilization + kontrak BPO overlap, tanpa expose expense internal).
- [x] **Portal notifications** — feed notifikasi + bell dengan near-realtime polling (visibility-aware, refresh saat tab aktif).
- [x] **Portal audit** — semua login attempt (SUCCESS / FAILURE_BAD_PASSWORD / FAILURE_LOCKED / LOGOUT / SESSION_EXPIRED) direkam di `portal_login_events` (retensi 7 tahun).

### AI Analytics (rules §15)
- [x] `predict-expense-impact` — proyeksi dampak biaya baru ke gross margin proyek.
- [x] `analyze-resource-utilization` — flag over/under-alokasi PM & karyawan.
- [x] `analyze-client-health` — skor kesehatan hubungan klien.
- [x] `analyze-sla-breach` — warning risiko penalti SLA 24-48 jam ke depan.
- [x] **AI Safety** — PII redaction sebelum kirim ke LLM (nama → hash, salary → range, bank_account → last-4, KTP dihilangkan), per-tenant daily token cap di Redis.

### Ops / Compliance
- [x] Immutable audit trail (`security_audit_logs`, INSERT-only, retensi 7 tahun).
- [x] 90-day secret rotation registry (`/settings/secrets`) + weekly rotation-check cron.
- [x] Cold archive registry (`/settings/archives`) + SHA-256 verification + retention worker.
- [x] Health / readiness / version endpoints (`/api/health`, `/api/ready`, `/api/version`).
- [x] Observability sink (Sentry / Axiom / Console / NoOp) + client crash reporter dengan Redis rate-limit.
- [x] i18n `id-ID` (default) + `en-US`, toggle di topbar, persist di `NEXT_LOCALE` cookie 1 tahun.

## Tech overview (elevator pitch)

- **Frontend + API**: Next.js 16 App Router (RSC-first + Server Actions), Tailwind CSS v4, Shadcn UI (base-nova preset), Framer Motion (dengan `useReducedMotion()`), Recharts + Tremor untuk visualisasi.
- **Data**: Supabase (Postgres 17 + RLS + GoTrue + Storage + custom JWT hook untuk claim `tenant_id`).
- **Multi-tenancy**: subdomain-per-tenant, dijaga di **empat lapis** (Proxy → Auth → PDP → RLS).
- **Money hygiene**: `numeric(18,2)` di Postgres, `bigint` cents di TS runtime, format via `Intl.NumberFormat('id-ID', { currency: 'IDR' })`.
- **Time hygiene**: `timestamptz` di storage, `tenants.timezone` (default `Asia/Jakarta`), konversi via `date-fns-tz`.
- **Deploy target**: Vercel (Singapore region `sin1`) + Supabase managed (Singapore) + Upstash Redis.

Detail arsitektur lengkap → [`../architecture.md`](../architecture.md).

## Non-goals (yang **tidak** dibuat)

- ❌ Bukan CRM lengkap — tidak ada pipeline penjualan / lead scoring. Modul `clients` cukup untuk BPO / managed services yang biasanya menang tender dulu baru sistem menyusul.
- ❌ Bukan payroll bank integration — payroll menghitung Direct Labor Cost tapi tidak push ke bank / BPJS API. Export CSV untuk provider payroll.
- ❌ Bukan e-signature — approval logs pakai `security_audit_logs` (siapa + kapan + IP + UA) yang secara hukum Indonesia setara "tanda tangan elektronik" per UU ITE untuk internal, tapi bukan penerbit sertifikat kualifikasi.
- ❌ Bukan platform mobile-first — responsif tapi UX-nya di-tune untuk desktop office. Mobile-shell (PWA) di roadmap.

## Where to go next

- **Bisnis / product owner** → [`business-processes.md`](business-processes.md) untuk end-to-end flow, lanjut ke modul-modul terkait di [`../modules/`](../modules/).
- **Engineer baru** → [`../getting-started.md`](../getting-started.md) + [`../architecture.md`](../architecture.md).
- **Security / compliance auditor** → [`../security-model.md`](../security-model.md) + [`../ops/data-retention.md`](../ops/data-retention.md).
- **End user (staff / manager / finance / HR)** → [`../user-guides/internal-users.md`](../user-guides/internal-users.md).
- **Client eksternal** → [`../user-guides/client-portal-users.md`](../user-guides/client-portal-users.md).
