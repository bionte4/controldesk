# Glossary

Istilah bisnis + teknis + akronim yang muncul di ControlDesk. Diurutkan
alfabetis, dwibahasa (ID / EN) ketika relevan. Setiap istilah menautkan
ke dokumen yang membahas lebih detail.

## Business terms (Indonesian ERP + BPO domain)

**ABAC** (*Attribute-Based Access Control*) — Model otorisasi yang
memutuskan izin berdasarkan **atribut** entitas (tenant_id, project_id,
status assignment, nominal transaksi), bukan hanya role. Dipakai oleh
PDP di `src/lib/security/pdp.ts`. Lihat rules §3.

**Anggaran** (*Budget*) — Total biaya yang direncanakan untuk sebuah
proyek, dipecah per kategori (Direct Labor, Operational, Sub-contract,
dst) di tabel `budget_details`. Perubahan setelah proyek berjalan
dilakukan lewat **Budget Request**.

**Approval Chain** — Urutan approver yang harus tanda tangan sebuah
pengajuan sebelum bisa dieksekusi. Untuk expense/CA/budget, chain
dihitung dinamis berdasarkan nominal. Lihat
[`approval-workflows.md`](approval-workflows.md).

**Audit Trail** (*Jejak Audit*) — Catatan immutable dari setiap mutasi
data sensitif — siapa, kapan, IP, UA, old_values, new_values. Disimpan
di `security_audit_logs` (INSERT-only, retensi 7 tahun sesuai UU PPh /
PPN).

**BPO** (*Business Process Outsourcing*) — Model bisnis di mana klien
menyewa tim outsource untuk menjalankan proses tertentu (Call Center,
Field Service, Data Entry, dsb). ControlDesk didesain untuk **provider
BPO**, bukan klien BPO.

**BPO Contract** — Perjanjian layanan antara tenant dan klien, punya
Monthly Recurring Revenue (MRR), start/end date, dan bisa terkait ke
banyak proyek. Lihat modul [`clients-and-portal.md`](../modules/clients-and-portal.md).

**Cash Advance / Kas Bon** — Uang muka kerja yang diambil karyawan
sebelum aktivitas dilakukan, kemudian di-settle setelah selesai dengan
upload nota. Dua jenis: **General** (bebas) dan **Field Ops** (khusus
lapangan, punya SLA settlement 10 hari).

**Client Portal** — Surface eksternal di `/portal/*` untuk user klien
melihat progress proyek mereka. Auth terpisah dari internal (via
`client_users`), tidak pakai `auth.users`.

**Cold Archive** — Data lama (past retention window) yang di-export ke
gzipped NDJSON di Supabase Storage bucket `tenant-archives`, dengan
SHA-256 checksum untuk verify integrity. Lihat
[`../ops/data-retention.md`](../ops/data-retention.md).

**CO_PM** — Co-Project Manager, PM sekunder pada satu proyek. Boleh ada
banyak. Menempel di `project_pm_assignments` dengan
`assignment_role = 'CO_PM'`.

**Direct Labor Cost (DLC)** — Biaya SDM langsung yang bisa dikaitkan ke
proyek — dihitung `hours_worked × hourly_rate +
hours_overtime × hourly_rate × OVERTIME_MULTIPLIER`. Basis utama untuk
Gross Margin BPO.

**Gross Margin (BPO)** — `Monthly Revenue − (DLC + Operational Expenses
+ Petty Cash Expenses + SLA Penalties)`. Metrik utama executive
dashboard.

**HRIS** (*Human Resource Information System*) — Modul yang mengelola
data karyawan, absensi, cuti/sakit/lembur, dan payroll. Lihat
[`../modules/hris-and-payroll.md`](../modules/hris-and-payroll.md).

**Imprest Fund System** — Model kas kecil yang lazim di Indonesia:
custodian pegang saldo tetap (misal Rp 5 juta), tiap voucher
mengurangi saldo, ketika saldo mendekati minimum → Custodian ajukan
**Replenishment** ke Lead Finance untuk isi ulang kembali ke saldo
tetap.

**KTP** (*Kartu Tanda Penduduk*) — Nomor identitas resmi Indonesia.
Termasuk PII sangat sensitif — di ControlDesk selalu di-encrypt at rest
via `pgcrypto` + mask di UI kecuali role HR / Finance / Admin.

**Lead Finance** — Role bertanggung jawab atas cashflow. Selalu jadi
**parallel gate** di semua approval keuangan (expense, cash advance,
budget request, petty cash replenishment).

**Milestone** — Titik pencapaian di proyek dengan due date + status
(PLANNED / IN_PROGRESS / DONE / AT_RISK / CANCELLED). Perubahan status
ke `DONE` / `AT_RISK` / `CANCELLED` otomatis kirim notifikasi ke
Client Portal.

**MRR** (*Monthly Recurring Revenue*) — Pendapatan bulanan berulang dari
kontrak BPO. Kolom `bpo_contracts.monthly_recurring_revenue`.

**NPWP** (*Nomor Pokok Wajib Pajak*) — Identitas wajib pajak Indonesia.
PII sensitif, encrypted at rest.

**OM** (*Operations Manager*) — Tingkat manajerial di atas PM,
membawahi beberapa PM sekaligus. Approver L3 di threshold matrix.

**PDP / PEP** (*Policy Decision Point / Policy Enforcement Point*) — PDP
adalah fungsi pure yang memutuskan ALLOW/DENY (`src/lib/security/pdp.ts`);
PEP adalah tempat keputusan itu ditegakkan (Next.js proxy, Server
Actions via `withSecureAction()`). Lihat [`../security-model.md`](../security-model.md).

**Petty Cash / Kas Kecil** — Uang tunai kecil di lokasi untuk
pengeluaran operasional minor (< Rp 2 juta). Dikelola dengan Imprest
Fund System.

**PII** (*Personally Identifiable Information*) — Data pribadi
teridentifikasi (nama, email, NIK, salary, bank account). Wajib
di-redact sebelum masuk log / AI prompt / observability sink.

**PM Handover** — Serah terima proyek dari PM lama ke PM baru,
memerlukan approval OM + Director. Otomatis transfer pending approvals,
tasks, dan roles active ke PM baru dalam satu DB transaction.

**Project Issue** — Tracker isu / masalah di proyek dengan severity
(Critical / High / Medium / Low), state machine (OPEN → IN_PROGRESS →
RESOLVED → CLOSED, plus REOPENED), dan **SLA business-hours** yang
memicu escalation otomatis kalau lewat batas waktu.

**RBAC** (*Role-Based Access Control*) — Model otorisasi berbasis
peran/role. ControlDesk pakai RBAC + ABAC layered. Lihat
[`roles-and-permissions.md`](roles-and-permissions.md).

**Retention Window** — Rentang waktu data harus disimpan sebelum boleh
diarsipkan/dipurge. Kebijakan ControlDesk:
- `security_audit_logs`: **7 tahun** (UU PPh, PPN)
- HR data terminated employee: **5 tahun** (anonymize, bukan hard delete)
- Financial records (expense, CA, petty cash): **10 tahun** (UU KUP)

**RLS** (*Row-Level Security*) — Fitur Postgres yang membatasi row
mana saja yang boleh dibaca/tulis berdasarkan `auth.jwt()` claims.
Layer terakhir isolasi tenant di ControlDesk.

**SLA** (*Service Level Agreement*) — Komitmen tingkat layanan (mis.
"response time < 4 jam", "uptime 99.5%"). Di ControlDesk direkam di
`sla_commitments` dan dipantau di dashboard eksekutif; breach → penalty
yang mengurangi gross margin.

**SLA Business Hours** — Perhitungan SLA yang hanya menghitung jam
kerja (default: Senin-Jumat 09:00-17:00 timezone tenant), bukan
kalender absolut. Dipakai di Project Issues.

**Threshold Matrix** — Tabel nominal yang menentukan level approval
berapa yang perlu tanda tangan. Lihat
[`approval-workflows.md`](approval-workflows.md#threshold-matrix).

**Timesheet** — Catatan jam kerja karyawan. Ada dua mode: **daily**
(entry per hari, di-approve satu-per-satu) dan **weekly** (packet
Senin-Minggu ISO-8601, di-approve satu paket sekaligus oleh PM).

**Tenant** — Perusahaan pelanggan ControlDesk. Satu tenant = satu
subdomain + satu isolated data namespace. `tenants` table di DB.

**Tenant Admin** — Role tertinggi di dalam satu tenant. Bisa invite user,
override approval, konfigurasi retention/secrets. Tidak bisa lintas
tenant (itu domain platform super-admin, tidak ada di ControlDesk).

## Technical terms

**`ActionResult<T>`** — Return type wajib untuk semua Server Actions:
`{ ok: true, data: T } | { ok: false, code, reason }`. DILARANG throw
error langsung ke client.

**`(app)` route group** — Semua route yang butuh sesi Supabase login,
di-serve di bawah subdomain `{tenant}.controldesk.app`.

**`(auth)` route group** — Route publik (login, register,
forgot-password).

**`(portal)` route group** — Route eksternal untuk klien, `/portal/*`.
Auth via `client_users` (bukan `auth.users`).

**`APP_ENCRYPTION_KEY`** — 64-hex-char symmetric key untuk `pgcrypto`
column encryption (salary, KTP, NPWP, bank_account_number). Rotasi 90
hari.

**`CRON_SECRET`** — Shared secret di header `Authorization: Bearer`
untuk semua cron endpoint di `/api/cron/*`.

**`current_tenant_id()`** — SECURITY DEFINER SQL function yang baca
`tenant_id` dari `auth.jwt()`. Basis semua RLS policy.

**`enqueue_notification` / `enqueue_portal_notification`** — Postgres
helper untuk publish notification ke in-app bell + email queue +
realtime channel.

**Feature folder** — Konvensi struktur folder per modul: `page.tsx +
actions.ts + components/*.tsx` di route group + `validation/*.ts` di
lib. Lihat rules §17.

**`getTenantContext()`** — RSC helper (`src/lib/tenant/context.ts`)
yang baca `x-tenant-slug` + `x-tenant-id` dari request headers
(di-inject oleh `proxy.ts`).

**JWT custom hook** — Postgres function yang inject claim `tenant_id`,
`tenant_slug`, `role`, `employee_id` ke access token saat GoTrue
menerbitkan JWT. Lihat migration `0003_rls_helpers.sql`.

**Proxy** (dulu **Middleware**) — Next.js 16 rename: `middleware.ts` →
`proxy.ts`. File di `src/proxy.ts` — melakukan tenant resolution + JWT
guard + header propagation. Lihat
[`../architecture.md#request-lifecycle`](../architecture.md#request-lifecycle).

**RSC** (*React Server Component*) — Default component type di
ControlDesk. Render di server, no JS bundle to client. Client
components dipakai HANYA untuk interaktif (form, dialog, animation).

**`security_audit_logs`** — Table jejak audit immutable. INSERT-only
via trigger `raise 42501 on UPDATE/DELETE`.

**Server Action** — Fungsi TypeScript yang di-mark `"use server"`,
dijalankan di server dari form/submit di client. Setiap mutasi Server
Action WAJIB wrapped via `withSecureAction()` — auth → Zod → PDP →
mutation → audit dalam satu call site.

**`withSecureAction()`** — Wrapper di
`src/lib/security/action-wrapper.ts` yang enforce Server Action
contract. Bukan optional — Server Action mutasi TANPA wrapper ini
adalah bug.

**`withCanonicalSecureAction()`** — Variant dari `withSecureAction()`
untuk resource yang pakai canonical role model (7-role) alih-alih
10-role legacy.

**Zod schema** — Validasi input di boundary Server Action. Single
source of truth di `src/lib/validation/{module}.ts`.

## Acronyms cheat sheet

| Singkatan | Kepanjangan                        | Konteks                          |
| --------- | ---------------------------------- | -------------------------------- |
| ABAC      | Attribute-Based Access Control     | Otorisasi                        |
| BPO       | Business Process Outsourcing       | Model bisnis target              |
| CA        | Cash Advance / Kas Bon             | Modul finance                    |
| DLC       | Direct Labor Cost                  | Payroll / margin BPO             |
| DPP       | Dasar Pengenaan Pajak              | PPN calculation                  |
| GM        | General Manager                    | Role (legacy 10-role)            |
| HM        | Head Manager                       | Role (legacy 10-role)            |
| HRIS      | Human Resource Information System  | Modul HR                         |
| KTP       | Kartu Tanda Penduduk               | PII sensitif                     |
| KUP       | Ketentuan Umum Perpajakan          | UU untuk retention finansial     |
| MRR       | Monthly Recurring Revenue          | Kontrak BPO                      |
| NPWP      | Nomor Pokok Wajib Pajak            | PII sensitif                     |
| OM        | Operations Manager                 | Role                             |
| P&L       | Profit & Loss                      | Dashboard executive              |
| PDP       | Policy Decision Point              | Security architecture            |
| PEP       | Policy Enforcement Point           | Security architecture            |
| PII       | Personally Identifiable Information| Redaction target                 |
| PM        | Project Manager                    | Role                             |
| PPh       | Pajak Penghasilan                  | UU untuk retention audit         |
| PPN       | Pajak Pertambahan Nilai            | UU untuk retention finansial     |
| RBAC      | Role-Based Access Control          | Otorisasi                        |
| RLS       | Row-Level Security                 | Postgres feature                 |
| RSC       | React Server Component             | Next.js paradigm                 |
| SLA       | Service Level Agreement            | Kontrak klien                    |
| SSR       | Server-Side Rendering              | Next.js paradigm                 |
| SSO       | Single Sign-On                     | (not implemented)                |
| TZ        | Timezone (`Asia/Jakarta` default)  | tenants.timezone                 |
| UAT       | User Acceptance Testing            | Deployment phase                 |
| UU        | Undang-Undang                      | Indonesian law                   |
| WIB       | Waktu Indonesia Barat (UTC+7)      | Default tenant TZ                |
