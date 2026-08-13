---
title: End-to-end walkthrough — dari provisioning tenant sampai proyek pertama selesai
summary: Panduan komprehensif memakai ControlDesk dari hari pertama sebuah tenant baru sampai proyek pertama delivered, dengan sample data lengkap di setiap step.
---

# End-to-end walkthrough

Doc ini menuntun Anda **dari hari pertama** sebuah tenant baru sampai
**proyek pertama tenant itu selesai** — mencakup semua modul utama
yang tersedia. Berbeda dengan
[`user-guide-workflows.md`](../training/user-guide-workflows.md) (per
role) atau [`internal-users.md`](../user-guides/internal-users.md)
(per persona), walkthrough ini **sekuensial** — Anda bisa mengikuti
step-by-step dan hasil setiap step menjadi input step berikutnya.

Semua contoh menggunakan **satu tenant fiktif** yang konsisten
sepanjang doc:

- **Tenant slug**: `nusadigital`
- **Nama**: PT Nusa Digital (software house Jakarta, ~15 orang)
- **URL**: `https://nusadigital.controldesk.app` (prod) atau
  `http://nusadigital.localhost:3001` (dev lokal)
- **Founder / Tenant Admin**: Sinta Rahayu (`sinta@nusadigital.co.id`)

Silakan ganti dengan tenant Anda sendiri saat mempraktikkan — struktur
langkah tetap sama.

## Peran vs orang: kenapa Sinta merangkap 3 topi

Rules §6 mendefinisikan **7 role internal + 1 role portal**:
`EMPLOYEE`, `SUPERVISOR`, `PM`, `OM` (Operations Manager),
`FINANCE`, `DIRECTOR`, `ADMIN` (TENANT_ADMIN), plus `CLIENT`. Tapi
role adalah **atribut approval-authority**, bukan orang. Satu orang
bisa punya lebih dari satu role — sistem tidak melarang.

Di sample Nusa Digital (~15 orang), pemetaan role → orang:

| Role                        | Orang                              | Kenapa dirangkap                                    |
| --------------------------- | ---------------------------------- | --------------------------------------------------- |
| `ADMIN` (TENANT_ADMIN)      | Sinta Rahayu (founder)             | Founder tenant selalu jadi admin awal               |
| `DIRECTOR`                  | Sinta Rahayu                       | Executive tier — di startup founder = director      |
| `OM` (Operations Manager)   | Sinta Rahayu (untuk sekarang)      | OM = "membawahi > 1 PM"; Nusa Digital baru 1 PM     |
| `FINANCE` (Lead Finance)    | Dewi Anggraini                     | Full-time Finance                                   |
| `PM` (Project Manager)      | Rangga Wibowo                      | Handle 1 project (E-commerce Rebuild MST)           |
| `SUPERVISOR`                | Rangga (sekaligus, sbg SPV Bagas)  | Team lead operasional                               |
| `EMPLOYEE`                  | Bagas Nugroho, Putri Amelia        | IC (individual contributor)                         |

### Kenapa Sinta bisa "merangkap" walau hanya punya 1 role

Kolom `employees.role` di database menerima **satu role per employee**.
Sinta hanya punya role `TENANT_ADMIN`. Namun rules §9 memberi
`TENANT_ADMIN` (canonical `ADMIN`) **override authority** ke semua
approval step di seluruh chain — dia bisa approve Expense sebagai
Finance, sebagai Director, ataupun sebagai OM. Fungsi
`canApproveExpenseAtRole()` di [`src/lib/rbac/roles.ts`](../../src/lib/rbac/roles.ts)
short-circuit `true` untuk `TENANT_ADMIN` di line 330. Setiap
override tercatat di `security_audit_logs` dengan `actor_role =
'TENANT_ADMIN'` sehingga jejak audit tetap jelas siapa yang
menyetujui.

Efeknya: **Sinta secara fungsional bertindak sebagai Director + OM
tanpa perlu 3 row employee terpisah**.

### Kalau tenant Anda lebih besar

Untuk organisasi 50+ orang / ≥ 3 PM, disarankan **pisahkan orangnya**
agar audit + accountability lebih jelas:

| Role                     | Siapa yang biasanya memegang            | Deskripsi rules §6                          |
| ------------------------ | --------------------------------------- | ------------------------------------------- |
| `DIRECTOR`               | C-level / VP / GM / Head of Ops         | Executive tier — approver terminal untuk nominal tinggi + read-all + executive dashboard |
| `OPERATIONS_MANAGER` (OM)| Lead PM / Delivery Manager              | Membawahi > 1 PM, sign-off Field Ops CA Rp 20-50jt, portfolio-level view |
| `TENANT_ADMIN` (ADMIN)   | Staf IT / HR / Ops (bukan founder)      | Kelola user, master data, integrasi, override emergency |

Cara set: **HR → Employees → New / Edit → Role** dropdown pilih role
kanonis yang tepat. Kalau Anda mengikuti walkthrough ini di tenant
besar, **swap nama Sinta** di bab-bab yang bertanda tebal
(**Director** / **OM**) dengan nama orang yang tepat di organisasi
Anda — mis. "Pak Hendra (OM)" untuk Field Ops CA Bab 9 step ke-3,
"Bu Ratih (Director)" untuk Bab 7 budget approval final.

## Prasyarat

Sebelum mulai:

- Anda sudah punya URL platform ControlDesk yang di-deploy (mis.
  `controldesk.app`) atau menjalankan Docker Compose lokal per
  [`getting-started.md`](../getting-started.md).
- Anda punya akses ke **Super Admin console** (`/super-admin`) — hanya
  platform operator yang punya ini. Kalau Anda tenant admin biasa,
  loncat ke [Bab 2](#bab-2--login-pertama-sebagai-tenant-admin).
- Anda tahu email + nama founder / pemilik tenant yang akan
  di-provision (di sini Sinta Rahayu).

## Peta ringkas (skim dulu sebelum kerjakan)

| Bab | Aktor                                    | Yang dilakukan                                  | Estimasi waktu |
| --- | ---------------------------------------- | ----------------------------------------------- | -------------- |
| 1   | Super Admin                              | Provision tenant baru + kirim invite            | 5 menit        |
| 2   | Tenant Admin                             | Login + selesaikan onboarding checklist         | 30 menit       |
| 3   | Tenant Admin                             | Isi master data: karyawan, klien                | 1 jam          |
| 4   | Tenant Admin                             | Bikin project + assign tim                      | 15 menit       |
| 5   | Tenant Admin *(sekaligus Director)*      | Setting approval threshold + unit whitelist     | 15 menit       |
| 6   | Employee + Supervisor                    | Isi Roster + Timesheet, PM approve weekly       | Harian         |
| 7   | PM + Finance + **Director**              | Bikin Budget + Budget Request (chain by nominal) | 30 menit       |
| 8   | Employee + PM + Finance                  | Ajukan Cash Advance General + settle            | 5 menit / kali |
| 9   | Field engineer + **Supervisor + PM + OM + Finance** | Ajukan Cash Advance Field Ops (2 skenario: kecil vs ≥ 20jt) | 5 menit / kali |
| 10  | Custodian + Finance                      | Setup Petty Cash Fund + voucher harian          | 5 menit / kali |
| 11  | PM (submitter) + Finance + **Director**  | Ajukan Project Expense (kecil vs ≥ 100jt)       | 5 menit / kali |
| 12  | Approver (PM / OM / Finance / Director)  | Approve items lewat Unified Inbox               | Harian, 10 menit |
| 13  | HR / SPV + PM (project reviewer) + **OM/Director** | Performance Evaluation menjelang perpanjangan | 30 menit / evaluasi |
| 14  | Klien                                    | Login ke Client Portal + lihat progress         | 5 menit        |
| 15  | Semua (highlight **Director** untuk KPI + audit) | Tutup bulan pertama — recap KPI                | 1 jam          |

**Legend**: bold role di kolom "Aktor" adalah peran approval-authority
(OM = Operations Manager, Director = executive tier). Di tenant kecil
seperti sample kita, satu orang bisa merangkap beberapa role — lihat
callout berikutnya.

---

## Bab 1 — Super Admin provision tenant baru

**Aktor:** Anda (platform operator).  
**Sample input:** slug `nusadigital`, admin email `sinta@nusadigital.co.id`, admin nama `Sinta Rahayu`.

1. Buka `https://controldesk.app/super-admin` (atau
   `http://localhost:3001/super-admin` lokal). Anda perlu login
   sebagai user platform admin — lihat
   [`../ops/tenant-provisioning.md`](../ops/tenant-provisioning.md)
   untuk cara jadi platform admin lokal.
2. Klik **Tenants → New tenant**.
3. Isi form:

   | Field       | Nilai contoh                     |
   | ----------- | -------------------------------- |
   | Slug        | `nusadigital`                    |
   | Nama tenant | `PT Nusa Digital`                |
   | Admin email | `sinta@nusadigital.co.id`        |
   | Admin nama  | `Sinta Rahayu`                   |

4. Klik **Provision**. Sistem menjalankan `public.provision_tenant()`
   yang otomatis:
   - Insert row di `public.tenants`.
   - Seed **Chart of Accounts** (57 rows) via `seed_default_coa()`.
   - Seed **master data lookup** (7 domain, ~76 rows) via
     `seed_default_master_data()` — termasuk `area`, `unit_pengaju`,
     `department`, `position`, `budget_category`, `transport_need`,
     `rab_category` (migration 0090).
   - Seed **2 template evaluasi kinerja** via
     `seed_default_eval_templates()` (migration 0088).
   - Insert row `TENANT_ADMIN` untuk Sinta di `public.employees`.
   - Insert audit log di `security_audit_logs`.

5. Halaman kembali ke daftar tenant, `nusadigital` muncul di paling atas.
6. Kirim email invite ke Sinta (sistem menampilkan tombol "Copy invite
   link" di detail tenant — link berisi one-time token untuk set
   password).

**Verifikasi**: buka `https://nusadigital.controldesk.app` — akan
redirect ke `/login` dengan tenant branding "PT Nusa Digital".

---

## Bab 2 — Login pertama sebagai Tenant Admin

**Aktor:** Sinta Rahayu (TENANT_ADMIN).

1. Sinta menerima email invite → klik link → dibawa ke halaman set
   password → login.
2. Halaman **Dashboard** kosong (belum ada karyawan / klien / proyek).
3. Di kanan atas, klik avatar → **Preferences**:
   - Bahasa: **🇮🇩 Bahasa Indonesia** (default).
   - Tema: **System** (mengikuti OS).
   - Notifikasi grid: biarkan default (Bell + Email aktif semua kategori).
4. Buka **Settings → Overview** — checklist onboarding muncul:

   ```
   Onboarding checklist (7 langkah)
   [ ] 1. Setup integrasi email SMTP        → Settings → Integrations → Email
   [ ] 2. (Opsional) Setup AI provider       → Settings → AI
   [ ] 3. (Opsional) Setup WhatsApp Fonnte   → Settings → Integrations → WhatsApp
   [ ] 4. Review approval thresholds         → Settings → Approval Thresholds
   [ ] 5. Isi master data karyawan           → HR → Employees → New
   [ ] 6. Isi klien pertama                  → Clients → New
   [ ] 7. Bikin project pertama              → Projects → New
   ```

5. Sinta setup **SMTP email** dulu (agar notifikasi approve/reject
   sampai ke user):
   - Buka **Settings → Integrations → Email (SMTP)**.
   - Isi host, port, username, password (mis. Resend / Postmark /
     Google Workspace).
   - Klik **Test send** — email test masuk ke inbox `sinta@`.
6. **AI provider** dilewat dulu — bisa di-setup nanti untuk AI
   Insights.
7. **Approval thresholds**: buka **Settings → Approval Thresholds**.
   Sinta melihat default 3-tier (Rp 5jt PM, Rp 50jt Director) sudah
   pas untuk skala PT Nusa Digital → **Save without changes**. Ini
   membuat baris row default di `approval_thresholds` (opsional —
   kalau tidak, sistem tetap fallback ke code constants).

---

## Bab 3 — Isi master data (karyawan + klien)

### 3.1 Karyawan

**Aktor:** Sinta.  
**Sample data yang akan di-input** (5 orang):

| Nama              | Email                              | Role internal    | Employment | Reports to    |
| ----------------- | ---------------------------------- | ---------------- | ---------- | ------------- |
| Sinta Rahayu      | `sinta@nusadigital.co.id`          | TENANT_ADMIN     | PERMANENT  | —             |
| Rangga Wibowo     | `rangga@nusadigital.co.id`         | PROJECT_MANAGER  | PERMANENT  | Sinta         |
| Dewi Anggraini    | `dewi@nusadigital.co.id`           | LEAD_FINANCE     | PERMANENT  | Sinta         |
| Bagas Nugroho     | `bagas@nusadigital.co.id`          | EMPLOYEE (Dev)   | CONTRACT   | Rangga        |
| Putri Amelia      | `putri@nusadigital.co.id`          | EMPLOYEE (QA)    | CONTRACT   | Rangga        |

Steps (ulangi 4x untuk yang belum ada):

1. **HR → Employees → New**.
2. Isi sheet:
   - Full name, email, phone.
   - **Role**: pilih dari dropdown (mis. `PROJECT_MANAGER` untuk Rangga).
   - **Reports to**: pilih Sinta.
   - **Employment type**: `PERMANENT` (Sinta/Rangga/Dewi) atau
     `CONTRACT` (Bagas/Putri).
   - Kalau `CONTRACT`, **contract_end_date wajib** (mis.
     `2027-01-31`) — sistem menolak submit tanpa tanggal ini.
   - **Department**: `PROJECT_DELIVERY` untuk Rangga/Bagas/Putri,
     `FINANCE` untuk Dewi (dropdown dari lookup domain `department`).
   - **Position**: mis. `MANAGER`, `SENIOR_ANALYST`, `AGENT`
     (dropdown dari lookup domain `position`).
3. **Salary** + **bank account** boleh di-skip dulu (bisa diisi HR
   Admin nanti — kolom encrypted via `pgcrypto`).
4. **Save**. Sistem otomatis:
   - INSERT `public.employees` row.
   - Kirim email invite ke email karyawan → mereka set password sendiri.
   - Insert audit log.

**Verifikasi**: buka **HR → Employees** — 5 row muncul, semua status
`Active`. Kolom "Reports to" menampilkan hierarki.

### 3.2 Klien

**Sample**: 2 klien pertama.

| Nama Klien             | Kode  | PIC                    | Email PIC                 |
| ---------------------- | ----- | ---------------------- | ------------------------- |
| PT Mitra Sejahtera     | `MST` | Ibu Ratna Kusuma       | `ratna@mitrasejahtera.id` |
| CV Alpha Konsultan     | `ALK` | Bapak Adi Prakoso      | `adi@alphakonsultan.co.id`|

1. **Clients → New**.
2. Isi form (nama, kode, PIC, alamat, NPWP kalau PKP).
3. **Save**. Bisa opsional aktifkan **Client Portal** di edit (kirim
   invite ke PIC untuk login read-only, lihat Bab 14).

---

## Bab 4 — Bikin proyek + assign tim

**Aktor:** Sinta atau Rangga (PM).  
**Sample project**: implementasi e-commerce untuk PT Mitra Sejahtera.

| Field              | Nilai                                    |
| ------------------ | ---------------------------------------- |
| Project number     | `NUSA-MST-EC-2026-01` (auto or manual)   |
| Nama               | `E-commerce Rebuild — MST`               |
| Client             | PT Mitra Sejahtera                       |
| Type               | `FIXED_PRICE`                            |
| Contract value     | `Rp 850.000.000`                         |
| Contract start     | `2026-08-15`                             |
| Contract end       | `2027-02-15`                             |
| Area               | `JABODETABEK` (Jakarta site visit)       |
| Status awal        | `DRAFT`                                  |

1. **Projects → New**. Isi form di atas → **Save**. State: `DRAFT`.
2. Naikkan status ke `PLANNED` di detail project (tombol "Move to
   Planning") setelah kontrak ditandatangani.
3. **Assignments** tab → **Add PM**:
   - Employee: Rangga Wibowo.
   - Assignment role: `PRIMARY_PM`.
   - Started at: `2026-08-15`.
   - Save.
4. **Add member** (ulangi untuk Bagas + Putri):
   - Bagas → role `DEVELOPER`, allocation `100%`, started `2026-08-15`.
   - Putri → role `QA_ENGINEER`, allocation `50%`, started `2026-08-15`.
   (Putri sisa 50% bisa untuk proyek lain — total per employee tidak
   boleh > 100%.)
5. **Milestones** tab → tambah 3 milestone besar:

   | Milestone        | Due date     | Weight | Status  |
   | ---------------- | ------------ | ------ | ------- |
   | Discovery + UX   | `2026-09-15` | 20     | PLANNED |
   | MVP Delivery     | `2026-11-30` | 50     | PLANNED |
   | Handover + UAT   | `2027-02-15` | 30     | PLANNED |

6. Status project ke `ACTIVE` — mulai eksekusi.

**Verifikasi**: buka `/dashboard` → tile "Active Projects" naik ke 1.
Buka `/assignments` → workload Bagas 100%, Putri 50%, sisanya
`remaining_pct`.

---

## Bab 5 — Approval threshold + Unit Pengaju whitelist

### 5.1 (Opsional) Kustomisasi approval threshold

Sinta merasa Rp 50jt untuk Director approval terlalu ketat untuk
proyek Nusa Digital (kebanyakan expense di bawah Rp 20jt). Dia
naikkan Director threshold khusus:

1. **Settings → Approval Thresholds** → tab **Expense**.
2. Ubah `director_threshold` dari `50.000.000` → `100.000.000`.
3. Notes: "Naikkan karena skala Nusa Digital kecil, kebanyakan expense
   ≤ Rp 20jt".
4. Save. Sistem update `approval_thresholds.director_threshold` untuk
   `kind='EXPENSE'`.

Efek: Expense Rp 60jt sekarang cukup **PM → Finance** (tidak lewat
Director). Untuk Rp 100jt atau lebih, tetap butuh Director sign-off.

### 5.2 (Opsional) Whitelist Unit Pengaju per project

Rangga ingin memastikan semua CA/Budget/Expense di project MST hanya
diajukan oleh unit yang relevan (bukan HR / Sales yang tidak terkait
project). Dia bikin whitelist:

1. Buka **Projects → E-commerce Rebuild MST → Settings** → tab **Allowed Units**.
2. Add: `PROJECT-OPS`, `NOC`.
3. Save. Row baru di `project_allowed_units`.

Efek: dropdown "Unit Pengaju" di form Budget/CA General/CA Field Ops
untuk project MST hanya menampilkan `Project Operations` + `NOC`.
Hint "Filtered by project whitelist" tampil di bawah dropdown. Petty
Cash tidak terpengaruh (per rules §Petty Cash — tidak ada `project_id`).

---

## Bab 6 — Ops harian: Roster + Timesheet

### 6.1 Setup Work Shift

**Aktor:** Sinta / HR Admin.  
**Sample**: 1 shift standar dulu.

1. **HR → Roster → Shifts tab → New**.
2. Isi:

   | Field              | Nilai              |
   | ------------------ | ------------------ |
   | Name               | `Regular Office`   |
   | Start time         | `09:00`            |
   | End time           | `18:00`            |
   | Is night shift     | `false`            |
   | Weekend allowance  | `Rp 0` (default)   |

3. Save. Sistem otomatis hitung `duration_interval` = `9 hours` di
   Postgres.

### 6.2 Roster mingguan

1. Buka **HR → Roster → Weekly view**. Grid menampilkan employee ×
   tanggal.
2. Klik cell (mis. Bagas, Senin 18 Agustus) → **Roster upsert sheet**.
3. Isi:

   | Field       | Nilai                                     |
   | ----------- | ----------------------------------------- |
   | Employee    | Bagas Nugroho                             |
   | Shift       | Regular Office                            |
   | Date        | `2026-08-18`                              |
   | Project     | E-commerce Rebuild MST (filtered — hanya project aktif Bagas) |
   | Status      | `SCHEDULED`                               |

   **Note**: dropdown "Project" **hanya menampilkan project MST**
   karena Bagas active-assigned di sana (guard commit `2e8a806`).
   Kalau Anda pilih employee lain yang tidak di-assign ke project
   apa pun, dropdown kosong.

4. Save. Ulangi untuk Sen-Jum minggu itu (atau pakai tombol "Copy
   week template" nanti).

### 6.3 Isi timesheet harian

**Aktor:** Bagas (EMPLOYEE) — dia login sendiri.

1. Bagas login `nusadigital.controldesk.app`.
2. **HR → My Timesheets → Weekly**. Halaman menampilkan minggu berjalan
   (Sen-Min ISO-8601).
3. Setiap hari kerja, isi:

   | Kolom            | Sen  | Sel  | Rab  | Kam  | Jum  | Sab  | Min  |
   | ---------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
   | Project (MST)    | 8    | 8    | 6    | 8    | 4    | 0    | 0    |
   | Internal (train) | 0    | 0    | 2    | 0    | 4    | 0    | 0    |

   Total minggu ini: 40 jam.

4. **Submit weekly** (deadline default Jumat 15:00 WIB) → status
   `SUBMITTED`. Notifikasi ke Rangga (PM).

**Verifikasi**: kalau Bagas iseng isi 4 jam untuk project "CV Alpha
Konsultan" yang dia tidak di-assign, sistem tolak dengan pesan
`"Project ... is not an active assignment for this employee"`
(server-side guard).

### 6.4 PM approve weekly packet

**Aktor:** Rangga.

1. Notifikasi bell muncul: "Bagas Nugroho submitted weekly timesheet
   for Aug 17-23".
2. Buka `/hr/timesheets/weekly/2026-08-17` → melihat 40 jam terpakai
   di 6 entri.
3. Kalau semua wajar → **Approve packet** → status `APPROVED`. Semua
   entri harian ikut `APPROVED`.
4. Kalau ada yang perlu revisi → **Reject with reason** → semua entri
   balik ke `REJECTED`, Bagas dapat notif untuk revisi.

---

## Bab 7 — Budget + Budget Request

### 7.1 PM bikin budget awal project

**Aktor:** Rangga.  
**Sample**: budget project MST Rp 850jt.

1. **Finance → Budgets → New**.
2. Isi header:

   | Field           | Nilai                          |
   | --------------- | ------------------------------ |
   | Project         | E-commerce Rebuild MST         |
   | Period          | `2026-08-15` – `2027-02-15`    |
   | Unit Pengaju    | `Project Operations` (dari whitelist Bab 5.2) |
   | Currency        | IDR                            |

3. Isi line items:

   | # | Kategori         | Deskripsi                       | Amount (IDR) |
   | - | ---------------- | ------------------------------- | -----------: |
   | 1 | DIRECT_LABOUR    | Dev + QA (Bagas + Putri 6 bulan)| 480.000.000  |
   | 2 | SUBCONTRACTOR    | UX consultant lepas             |  60.000.000  |
   | 3 | INFRASTRUCTURE   | Cloud + CDN 6 bulan             |  90.000.000  |
   | 4 | TOOLING          | Lisensi Figma + monitoring      |  30.000.000  |
   | 5 | CONTINGENCY      | Reserve 10%                     |  85.000.000  |
   |   |                  | **Total planned**               | **745.000.000** |

4. **Submit for approval**. Total Rp 745jt → chain
   **Finance → Director** (di atas threshold 50jt, per rules §9.2).
5. Dewi (Finance) approve → notif ke Sinta (Director role via
   TENANT_ADMIN).
6. Sinta approve → status `APPROVED`, budget mulai berlaku.

### 7.2 Ganti budget di tengah project (Budget Request)

Bulan ke-2, ternyata cloud cost lebih besar dari estimasi karena
traffic tinggi. Rangga perlu transfer Rp 15jt dari CONTINGENCY ke
INFRASTRUCTURE.

1. **Finance → Budget Requests → New**.
2. Isi:

   | Field             | Nilai                                                 |
   | ----------------- | ----------------------------------------------------- |
   | Kind              | `TRANSFER`                                            |
   | From line         | CONTINGENCY (Rp 85jt tersedia)                        |
   | To line           | INFRASTRUCTURE (Rp 90jt existing)                     |
   | Amount            | `Rp 15.000.000`                                       |
   | Justification     | "Cloud cost overrun 20% karena traffic launch minggu 3" |

3. Submit → total nominal Rp 15jt < 50jt → chain **Finance only**.
4. Dewi approve → status `APPROVED` → sistem trigger step `APPLIED`
   di transaksi yang sama:
   - `budget_details` CONTINGENCY: `85jt → 70jt`.
   - `budget_details` INFRASTRUCTURE: `90jt → 105jt`.
   - `budgets.total_planned` tetap Rp 745jt (transfer, bukan increase).

**Verifikasi**: buka **Finance → Budgets → E-commerce Rebuild MST**,
Progress bar per kategori menunjukkan alokasi baru.

---

## Bab 8 — Cash Advance General

**Aktor:** Bagas (EMPLOYEE).  
**Sample**: Bagas butuh Rp 3.500.000 untuk beli lisensi library premium.

1. **Finance → Cash Advances → New (General)**.
2. Isi:

   | Field                    | Nilai                                       |
   | ------------------------ | ------------------------------------------- |
   | Type                     | `General`                                   |
   | Project (opsional)       | E-commerce Rebuild MST                      |
   | Unit Pengaju             | `Project Operations`                        |
   | Budget line (opsional)   | TOOLING                                     |
   | Amount                   | `Rp 3.500.000`                              |
   | Purpose                  | "Beli lisensi library X untuk fitur report" |
   | Expected settlement date | `2026-09-15`                                |

3. Submit → nominal Rp 3.5jt ≥ 2jt, < 20jt → chain **PM → Finance**.
4. Rangga approve → notif ke Dewi.
5. Dewi disburse: **Cash Advances → detail → Disburse** → isi:
   - `disbursed_at`: `2026-09-01 10:00`.
   - `disbursement_method`: `BANK_TRANSFER`.
   - `reference_number`: `TRF-20260901-001`.
   Status: `DISBURSED`. Sistem catat `disbursed_at`, tarik saldo di
   general ledger.

Sistem otomatis set `settlement_due_date` = `2026-09-15`.

### 8.1 Settlement (setelah expense terjadi)

Setelah beli lisensi, harga aktual Rp 3.750.000 (kelebihan Rp 250.000
— under-budget karena dapat diskon minor):

1. Bagas buka CA yang tadi → **Add line item**:
   - Category: `TOOLING`.
   - Description: "Lisensi library X — 1 year".
   - Amount: `Rp 3.750.000`.
   - Receipt attachment: upload PDF invoice.
2. **Submit for settlement** → status `PENDING_SETTLEMENT`.
3. Dewi review — melihat aktual > advance. Ada 2 pilihan:
   - **Reimbursement top-up** Rp 250.000 ke Bagas → click "Approve
     with top-up". Sistem catat `settlement_variance = -250.000`.
   - **Return excess** kalau aktual < advance → Bagas transfer selisih
     balik ke perusahaan.
4. Status → `SETTLED`. Selesai.

---

## Bab 9 — Cash Advance Field Ops

**Aktor:** Putri (QA) — butuh site visit ke kantor MST di BSD untuk
UAT testing.  
**Sample**: 1 hari trip PP Jakarta-BSD, RAB Rp 800.000.

1. **Finance → Cash Advances → New (Field Ops)**.
2. Isi:

   | Field                | Nilai                                         |
   | -------------------- | --------------------------------------------- |
   | Type                 | `Field Ops`                                   |
   | Project              | E-commerce Rebuild MST                        |
   | Unit Pengaju         | `Project Operations`                          |
   | Ticket ref (opsional)| `MST-UAT-001`                                 |
   | Site location        | `Kantor MST BSD`                              |
   | Justification        | `SiteSurvey`                                  |
   | Vehicle type         | `TAKSI-GRAB`                                  |
   | Date range           | `2026-10-05` – `2026-10-05`                   |

3. Line items RAB:

   | Category      | Item                    | Amount    |
   | ------------- | ----------------------- | --------: |
   | TRANSPORTASI  | Grab PP Jakarta-BSD     | 300.000   |
   | KONSUMSI      | Makan siang + snack     | 100.000   |
   | KOMUNIKASI    | Paket data on-site      |  50.000   |
   | LAIN-LAIN     | Kunci parkir + reserve  | 350.000   |
   |               | **Total**               | **800.000** |

4. Submit → nominal Rp 800k < 5jt → chain **Supervisor → Finance**
   (Field Ops SELALU lewat Supervisor per rules §9.4).
5. Rangga (SPV Putri) approve → Dewi disburse.
6. `settlement_due_date` = disbursement + 10 hari (per
   `FIELD_OPS_SETTLEMENT_SLA_DAYS`) = mis. `2026-10-15`.
7. Reminder otomatis kirim H-3, H+0, H+1, H+3, H+7 dari due date
   kalau belum settle.

### 9.1 Settlement Field Ops

Setelah kunjungan:

1. Putri isi actual expense di CA detail → upload foto struk semua.
2. Kalau aktual Rp 750k (lebih hemat Rp 50k) → **Return excess** ke
   custodian → status `SETTLED`.
3. Chain settlement Field Ops: `PendingSettlementSupervisor →
   PendingSettlement (Finance) → Settled` (untuk nominal < 20jt tidak
   perlu OM step).

### 9.2 Sample kedua — Field Ops besar Rp 28jt (memperkenalkan peran OM)

Beberapa minggu kemudian, Bagas perlu on-site di kantor MST BSD
selama **5 hari** untuk go-live support. Estimasi Rp 28.000.000
(akomodasi hotel BSD 4 malam + Grab PP setiap hari + konsumsi
lengkap + kunci parkir + reserve komunikasi).

**Aktor tambahan** (baru muncul di sini):

- **Pak Hendra Setiawan** — role `OPERATIONS_MANAGER`. Di Nusa Digital
  fase awal, Sinta merangkap OM. Bila organisasi sudah punya OM
  terpisah (>1 PM di-supervisi), swap ke Pak Hendra untuk step ini.
- **Sinta Rahayu** — di sini pakai topi `DIRECTOR` (karena Rp 28jt <
  50jt, sebenarnya Director step tidak wajib, tapi lihat catatan di
  bawah).

**Chain lengkap** (rules §9.4):

```
Supervisor (Rangga) → PM (Rangga, self karena dia PM project) → OM (Hendra) → Finance (Dewi)
```

Karena nominal Rp 28jt ≥ Rp 20jt, **slot OM ikut aktif** (rules §9.4
row "≥ 5jt: +PM; ≥ 20jt: +OM"). Director step tidak wajib karena < 50jt.

**Step-by-step**:

1. Bagas ajukan Field Ops CA baru, header sama seperti 9.0 tapi:
   - `Date range`: `2026-11-10` – `2026-11-14` (5 hari).
   - `Justification`: `NewInstallation`.
2. Line items RAB:

   | Category      | Item                              | Amount     |
   | ------------- | --------------------------------- | ---------: |
   | AKOMODASI     | Hotel Aston BSD 4 malam           | 4.400.000  |
   | TRANSPORTASI  | Grab PP Jakarta-BSD 5 hari        | 3.000.000  |
   | TIKET-PESAWAT | (tidak dipakai, dihapus)          | —          |
   | KONSUMSI      | Makan 3x sehari x 5 hari x 2 org  | 3.500.000  |
   | TOLL-PARKIR   | Toll + parkir kendaraan operasional| 1.200.000  |
   | SEWA-ALAT     | Sewa laptop cadangan + kabel jaringan | 12.000.000 |
   | KOMUNIKASI    | Paket data 5G on-site             |  400.000   |
   | LAIN-LAIN     | Reserve 10%                       | 3.500.000  |
   |               | **Total**                         | **28.000.000** |

3. Submit → sistem resolve chain:
   - **Supervisor step**: Rangga (Bagas `reports_to = Rangga`).
   - **PM step**: Rangga (dia PM primary project MST). Karena
     Rangga = Supervisor **DAN** PM Bagas untuk project ini, sistem
     tetap tampilkan 2 slot terpisah tapi bisa **satu klik approve
     mengisi keduanya** (auto-fill kedua rung dengan single decision;
     audit log tetap 2 rows).
   - **OM step**: Pak Hendra Setiawan (auto-resolve dari Rangga
     `reports_to`, chain naik). Kalau Rangga `reports_to = Sinta`
     langsung, sistem set OM = Sinta.
   - **Finance step**: Dewi Anggraini (parallel gate — bisa approve
     tanpa menunggu OM).
4. Rangga approve dua slot atas dalam 1 klik.
5. Pak Hendra terima notif → review justifikasi + line items → dia
   melihat SEWA-ALAT Rp 12jt agak tinggi → tambah komentar
   "Konfirmasi butuh laptop cadangan? Pinjam dari kantor bisa?"
   Bagas balas: "Kantor sedang dipakai tim lain, sudah dicek."
   Hendra **approve dengan komentar**.
6. Dewi (Finance) approve → status `APPROVED` → disburse Rp 28jt via
   transfer bank atau dompet CA custodian.

**Timeline yang muncul di detail page**:

```
● Submitted by Bagas          2026-10-28 08:15
● Supervisor (Rangga)         2026-10-28 09:00 ✓
● PM (Rangga)                 2026-10-28 09:00 ✓ (single-click)
● OM (Hendra)                 2026-10-28 14:30 ✓ "Konfirmasi laptop..."
● Finance (Dewi)              2026-10-28 15:10 ✓
● Disbursed                   2026-10-29 10:00
```

**Kalau nominal ≥ 50jt** (mis. Rp 65jt untuk trip antar-pulau):
tambahan **Director step** ikut aktif → chain `Supervisor → PM → OM →
Finance → Director`. Sinta (Director) jadi rung terakhir sebelum
disbursement. Untuk skenario ini biasanya butuh justification tebal
(target site, deliverable, timeline).

**Settlement chain juga bertingkat**:

- `PendingSettlementSupervisor` → Rangga verify semua struk sesuai.
- `PendingSettlementOM` → Hendra verify aktual vs RAB (untuk ≥ 20jt).
- `PendingSettlement (Finance)` → Dewi finalize + refund/top-up.
- `Settled`.

---

## Bab 10 — Petty Cash

### 10.1 Setup Petty Cash Fund

**Aktor:** Sinta atau Dewi.  
**Sample**: 1 fund untuk kantor Jakarta.

1. **Finance → Petty Cash → Funds → New**.
2. Isi:

   | Field                   | Nilai                             |
   | ----------------------- | --------------------------------- |
   | Name                    | `Petty Cash Jakarta HQ`           |
   | Location                | `Kantor Thamrin`                  |
   | Custodian               | Putri Amelia (sekaligus admin)    |
   | Opening balance         | `Rp 5.000.000`                    |
   | Min threshold           | `Rp 1.000.000`                    |
   | Currency                | IDR                               |

3. Save. Row `petty_cash_funds` created, `current_balance =
   5.000.000`, status `Active`.

### 10.2 Voucher spend harian

Putri custodian keluar Rp 150.000 untuk beli meterai + kopi rapat:

1. **Petty Cash → Jakarta HQ → New Voucher**.
2. Isi:

   | Field         | Nilai                                    |
   | ------------- | ---------------------------------------- |
   | Kind          | `SPEND`                                  |
   | Category      | `OPERATIONS`                             |
   | Description   | "Meterai Rp 10.000 x 10 + kopi rapat"    |
   | Amount        | `Rp 150.000`                             |
   | Unit Pengaju  | `Management` (bebas — petty tanpa whitelist project) |
   | Receipt       | (opsional untuk < 100k; direkomendasikan untuk audit) |

3. Amount `< Rp 200k` → **auto-approve** langsung → status `APPROVED
   → Posted`. `current_balance` turun ke `Rp 4.850.000`.

Kalau nominal Rp 500.000:

1. Amount `≥ Rp 200k, ≤ Rp 2jt` → chain **Finance only** (Dewi review).
2. Amount `> Rp 2jt` → **ditolak** — pakai flow Expense biasa (Petty
   Cash punya hard ceiling per rules §Petty Cash).

### 10.3 Replenishment

Ketika balance turun ke `Rp 900.000` (< min threshold Rp 1jt):

1. Sistem kirim notif `PETTY_CASH_REPLENISH_NEEDED` ke Putri + Dewi.
2. Putri buka fund detail → **Request replenishment** → sistem hitung
   selisih untuk kembali ke opening (`5jt - 900k = 4.100.000`).
3. Dewi approve → transfer Rp 4.100.000 dari bank ke petty cash →
   isi form disbursement → `current_balance` naik lagi ke Rp 5jt.

### 10.4 Rekonsiliasi mingguan

Setiap Senin:

1. Putri buka fund → **New reconciliation**.
2. Hitung fisik uang di dompet kas: mis. `Rp 3.240.000`.
3. Sistem hitung ledger = jumlah opening + replenishments − posted
   vouchers = mis. `Rp 3.250.000`.
4. Variance `= 3.240.000 - 3.250.000 = -10.000`. `|variance| ≤ 5.000`
   (default tolerance) — tidak butuh reason.
5. Kalau variance > toleransi → wajib isi `variance_reason` text.
6. Submit → status `RECONCILED`.

---

## Bab 11 — Project Expense

**Aktor:** Rangga (PM).  
**Sample**: bayar UX consultant tahap 1 Rp 25.000.000.

1. **Finance → Expenses → New**.
2. Isi:

   | Field           | Nilai                                          |
   | --------------- | ---------------------------------------------- |
   | Project         | E-commerce Rebuild MST                         |
   | Budget line     | SUBCONTRACTOR                                  |
   | Unit Pengaju    | `Project Operations`                           |
   | Vendor          | `Studio Cerah UX` (freetext atau vendor lookup)|
   | Amount          | `Rp 25.000.000`                                |
   | Invoice number  | `INV-CERAH-20261012-001`                       |
   | Invoice date    | `2026-10-12`                                   |
   | Due date        | `2026-10-27` (net 15)                          |
   | Description     | "Discovery + wireframe sprint 1-2"             |
   | Attachment      | invoice PDF + kontrak vendor (opsional)        |

3. Submit → nominal Rp 25jt (≥ 5jt, < 100jt karena Sinta customize
   threshold Bab 5.1) → chain **PM → Finance** (tanpa Director).
4. Rangga adalah submitter, jadi step "PM" auto-approved (self-approve
   PM diperbolehkan karena Rangga adalah PM project itu).
5. Notif ke Dewi (Finance). Dewi approve → status `APPROVED`.
6. Dewi bayar via bank → **Mark as Paid** → status `PAID`. Sistem
   catat `paid_at`, `payment_reference`.

**Sample kedua** — expense besar Rp 120.000.000 untuk hardware:

- Chain karena ≥ Rp 100jt → **PM → Finance → Director**.
- Semua 3 slot butuh approve sebelum bisa `PAID`.
- Kalau butuh cepat, Sinta (Director) bisa short-circuit: buka detail
  → **Override chain** → isi justifikasi ≥ 20 karakter → status
  `APPROVED` langsung dengan audit trail lengkap.

---

## Bab 12 — Approval Inbox

**Aktor:** Dewi (Finance) atau Sinta (Director) atau Rangga (PM).

Semua item pending approval di berbagai modul kumpul di satu tempat.

1. Buka **/approvals** dari sidebar (badge menunjukkan unread count).
2. Filter: **Assigned to me** (default) — hanya item yang butuh
   tindakan Anda.
3. Tab menampilkan:

   | Tab              | Yang muncul                                      |
   | ---------------- | ------------------------------------------------ |
   | Expense          | Project expense yang pending di slot Anda        |
   | Cash Advance     | CA General + Field Ops pending di slot Anda      |
   | Petty Cash       | Voucher `PENDING_FINANCE` (Finance only)         |
   | Budget           | Budget baru + Budget Request                     |
   | Settlement       | CA settlement finalization (Finance only)        |
   | HR               | LEAVE/OVERTIME/SICK di slot Anda                 |

4. Klik satu item → slide-over drawer muncul dengan **timeline
   Approval Chain Progress** (visualisasi step per role):

   ```
   ● Submitted by Bagas    2026-09-01 09:15
   ● PM (Rangga)           2026-09-01 10:22 ✓
   ○ Finance (Dewi)        <— pending, giliran Anda
   ```

5. Baca detail → tombol **Approve** / **Reject with reason** /
   **Comment**. Approve langsung → notif ke slot berikutnya.
6. **Realtime**: bila approver lain approve item yang Anda buka,
   halaman auto-refresh (Supabase Realtime subscription ke
   `tenant:{tenant_id}:approvals`).

**Tip UX**: pakai keyboard shortcut:
- `J` / `K` — pindah antar item.
- `A` — approve item aktif.
- `R` — buka reject dialog.
- `Cmd/Ctrl+K` — command palette untuk lompat ke modul lain.

---

## Bab 13 — Performance Evaluation

**Aktor:** Dewi mem-flag bahwa kontrak Bagas akan expire dalam 30 hari.
Sistem otomatis muncul hint di dashboard HR: "3 kontrak akan expire —
mulai evaluasi kinerja".  
**Sample**: evaluasi Bagas untuk perpanjangan kontrak.

1. **HR → Performance → New evaluation**.
2. Isi:

   | Field                    | Nilai                                             |
   | ------------------------ | ------------------------------------------------- |
   | Employee                 | Bagas Nugroho                                     |
   | Template                 | `Evaluasi Triwulanan PKWT` (auto-seeded di provisioning) |
   | Contract end date        | auto-fill dari `employees.contract_end_date`      |
   | Project context (opsional)| `E-commerce Rebuild MST`                         |
   | Project reviewer         | auto-resolve → Rangga (PRIMARY_PM project MST)    |
   | SPV (auto)               | Rangga (dari `reports_to`)                        |

3. Save. Status `DRAFT`.
4. Rangga login → notifikasi `EVALUATION_PROJECT_REVIEW_REQUESTED`
   masuk (karena dia project reviewer).
5. **Sinta (SPV)** buka evaluasi → isi jawaban COMPETENCY (mis.
   Rangga sebagai SPV struktural Bagas):
   - Q1 Technical skill: 4/5, catatan "Delivery on-time, code
     quality baik".
   - Q2 Communication: 3/5, catatan "Perlu improve async writing".
   - Goal 1 (Ship feature X): 90% achieved.
   - Note bebas: "Rekomendasi perpanjang 12 bulan dengan naik grade".
6. Sinta submit → status `SUBMITTED_BY_SPV`.
7. **Rangga (PM struktural + project reviewer)** buka detail →
   **Project Reviewer Card** muncul di atas. Isi notes:
   > "Delivery quality sangat baik selama project MST — 3 milestone
   > tepat waktu, code review comments minimal. Recommend perpanjangan
   > kontrak."
   Submit via `submitProjectReviewerNotesAction`. Status evaluation
   tetap sama, tapi `project_reviewer_notes` + `project_reviewed_at`
   ter-populate. Notifikasi `EVALUATION_PROJECT_REVIEWED` kirim ke
   SPV/OM.
8. Rangga sebagai PM struktural juga bisa **Approve as PM** → status
   `REVIEWED_BY_PM`.
9. **Sinta (OM/Director)** finalize:
   - Decision: `EXTEND`.
   - Extension months: `12`.
   - Save → status `FINALIZED_BY_OM`.
10. Dewi (HR) buka finalized eval → generate UPK (Unit Penilaian
    Kinerja) note → update `employees.contract_end_date` +12 bulan.

---

## Bab 14 — Client Portal experience

**Aktor:** Ibu Ratna (PIC PT Mitra Sejahtera).  
**Sample**: Ratna mau cek progress project.

### 14.1 Sinta invite Ratna ke portal

1. **Clients → PT Mitra Sejahtera → Portal access** → **Invite user**.
2. Email: `ratna@mitrasejahtera.id`. Role: `CLIENT_VIEWER`.
3. Save → sistem kirim email invite ke Ratna dengan link
   `nusadigital.controldesk.app/portal/login`.

### 14.2 Ratna login

1. Ratna set password → login.
2. Halaman **Portal Dashboard**:
   - Project card "E-commerce Rebuild MST" — progress 40%, milestone
     progress bar, next milestone due date.
   - Recent documents (kalau ada shared attachment).
3. Klik project → detail (read-only):
   - Milestone tab: PLANNED/IN_PROGRESS/COMPLETED per milestone.
   - Documents tab: files yang di-share Rangga (mis. wireframe PDF,
     UAT script).
   - Contact tab: PIC Nusa Digital (Rangga) + kontak.
4. Ratna **tidak bisa** lihat: expense, cash advance, budget internal,
   employee data, salary, timesheet — semua RLS-blocked (tabel
   `client_users` terpisah dari `employees`).

**Verifikasi**: Ratna coba akses langsung URL `/finance/expenses` →
403 Forbidden. Sistem log attempt di audit.

---

## Bab 15 — Tutup bulan pertama: KPI + Audit

**Aktor:** Sinta melihat rekap awal September.

### 15.1 Dashboard executive

1. Buka **/dashboard**. Tiles menampilkan:

   | Tile                      | Value awal September                      |
   | ------------------------- | ----------------------------------------- |
   | Active projects           | 1 (MST)                                   |
   | Total contract value      | Rp 850.000.000                            |
   | Committed spend           | Rp 745.000.000 (budget approved)          |
   | Actual spend YTD          | Rp 45.500.000 (expense + CA settled)      |
   | Utilization avg           | 75% (Bagas 100%, Putri 50%, avg 4 employee) |
   | Pending approvals         | 3 items                                   |
   | SLA breach risk (24-48h)  | 0 items                                   |

2. Chart: sparkline "Cash burn rate" per minggu.
3. Klik tile → drill-down ke daftar detail.

### 15.2 Audit trail check

Sinta paranoid dan mau verifikasi tidak ada perubahan mencurigakan:

1. **Settings → Audit Logs** (role TENANT_ADMIN).
2. Filter: `resource_name = 'expenses'`, `action_type = 'UPDATE'`,
   date range Sep 1-30.
3. Melihat setiap UPDATE — kolom `old_values` + `new_values`
   menunjukkan diff. Semua row `immutable` (only INSERT allowed) —
   tidak ada yang bisa hapus jejak.
4. Sample: expense UX consultant Rp 25jt punya audit 3 log:
   - `INSERT` by Rangga (submit).
   - `UPDATE` by Dewi (approve, status `APPROVED`).
   - `UPDATE` by Dewi (mark paid, `paid_at` set).

### 15.3 Compliance retention

Semua tabel finance (expenses, cash_advances, petty_cash_vouchers)
retained minimum **10 tahun** sesuai UU KUP. Audit log retained **7
tahun** sesuai PPh/PPN. HR data karyawan terminated akan
di-anonymize (bukan hard delete) setelah 5 tahun.

### 15.4 Selanjutnya

- **Bulan ke-2**: Rangga bikin milestone MVP Delivery (2026-11-30)
  update progress harian → dashboard live update.
- **Bulan ke-3**: Payroll pertama (`/hr/payroll`) — Dewi lock period,
  export CSV untuk bank.
- **Bulan ke-6**: Handover + UAT — trigger client feedback survey via
  portal.
- **Bulan ke-12**: Contract renewal Bagas → cycle kembali ke Bab 13.

---

## Sample data recap

Kalau Anda ingin mempraktikkan walkthrough ini di environment lokal,
gunakan `scripts/seed-itps-parity.sql` sebagai template — modifikasi
identifier (`itps` → `nusadigital`, employee names, project names) lalu
jalankan:

```bash
# 1. Provision tenant baru (Bab 1)
docker exec -i supabase_db_controldesk psql -U postgres -d postgres <<SQL
select public.provision_tenant(
  'nusadigital',
  'PT Nusa Digital',
  'YOUR_AUTH_UID_HERE'::uuid,
  'sinta@nusadigital.co.id',
  'Sinta Rahayu',
  'e2e-walkthrough-script'
);
SQL

# 2. Login sebagai Sinta lalu isi master data lewat UI (Bab 3+)
```

Untuk auth user, buat via Supabase Studio (`http://localhost:54323`)
di tab Authentication → Add user, catat `id` UUID-nya.

## Where to look next

- Setiap modul punya doc dedicated:
  - Finance detail → [`../modules/finance.md`](../modules/finance.md)
  - HR + Performance → [`../modules/hris-and-payroll.md`](../modules/hris-and-payroll.md)
  - Projects + Assignments → [`../modules/projects.md`](../modules/projects.md)
  - Clients + Portal → [`../modules/clients-and-portal.md`](../modules/clients-and-portal.md)
  - AI Insights + Notifications → [`../modules/ai-and-notifications.md`](../modules/ai-and-notifications.md)
- Approval chain matrix lengkap → [`approval-workflows.md`](approval-workflows.md).
- Per-role daily task → [`../user-guides/internal-users.md`](../user-guides/internal-users.md).
- Panduan visual per modul → [`../training/user-guide-workflows.md`](../training/user-guide-workflows.md).
- Client portal user guide → [`../user-guides/client-portal-users.md`](../user-guides/client-portal-users.md).
- Ops: provision tenant, secret rotation, retention → [`../ops/`](../ops/).
