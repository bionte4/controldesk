# User guide — internal users

Panduan operasional untuk **staff internal** ControlDesk, per role.
Kalau Anda seorang **client eksternal** (pengguna Client Portal), pakai
[`client-portal-users.md`](client-portal-users.md).

Semua panduan asumsikan Anda sudah bisa login (email + password
dikirimkan oleh Tenant Admin Anda). Kalau belum bisa login, kontak
Tenant Admin di perusahaan Anda.

## First steps (semua role)

1. Buka URL yang diberikan admin: `https://{perusahaan}.controldesk.app`.
2. Login dengan email kerja + password.
3. Bahasa: klik toggle 🇮🇩/🇬🇧 di kanan atas untuk switch. Bahasa Indonesia default.
4. Tema: toggle dark/light di topbar juga.
5. Command Palette: tekan **Cmd+K** (Mac) / **Ctrl+K** (Win) untuk jump ke module manapun cepat.
6. Setiap notifikasi baru muncul di **bell icon** di topbar. Klik untuk melihat semua notifikasi.

---

## Employee

**Role**: `EMPLOYEE` — staff lapangan / kantor operasional.

### Daily checklist

- **Isi timesheet harian** kalau tenant pakai mode daily.
- **Submit weekly packet** setiap Senin (untuk minggu lalu) kalau tenant pakai mode weekly.
- **Cek notifikasi** — request cuti/sakit/lembur atau expense/kas bon Anda mungkin butuh follow-up.

### Isi timesheet harian

`/hr/timesheets` → tombol "New timesheet entry"

1. Pilih **project** dari dropdown (yang aktif Anda ter-assign).
2. Set **work date** (default hari ini).
3. Isi **hours worked** (regular) — misal 8.
4. Isi **hours overtime** (kalau ada dan sudah pre-approved via HR OT request).
5. Isi **description** singkat pekerjaan (memudahkan approver PM).
6. Klik **Submit** — status akan pindah ke `SUBMITTED`, menunggu approval PM/Supervisor.

### Submit weekly packet

`/hr/timesheets/weekly` → pilih minggu, isi entry Senin-Minggu.

1. Klik row hari → isi hours worked, project, description.
2. Setelah 7 hari terisi (atau seminimal berapa yang perlu), klik **Submit packet**.
3. Packet + semua entry sekaligus di-approve/reject oleh PM.

### Ajukan cuti / lembur

`/hr/requests` → **New request**

1. Pilih **kind**: `LEAVE` untuk cuti, `OVERTIME` untuk lembur, `SICK` untuk sakit.
2. Untuk `LEAVE`: pilih `leave_type` (Annual / Personal / Maternity / Paternity / Unpaid).
3. Set **start date** dan **end date**.
4. Isi **reason** — konkret. Reject rate lebih rendah kalau reason jelas.
5. Untuk `SICK`: **wajib upload surat dokter** (PDF/JPG/PNG, max 10 MB).
6. Klik **Submit** → status `PENDING_L1_SUPERVISOR`.

**Approval chain** (dari perspektif Anda menunggu):
- `LEAVE` / `OVERTIME`: Supervisor → PM → OM → HR Admin.
- `SICK`: Supervisor → HR Admin (chain lebih pendek karena butuh cepat).

Track progress di `/hr/requests/[id]` — chain visual menunjukkan siapa yang sedang review sekarang.

### Submit expense / kas bon

`/finance/expenses` (untuk expense yang **sudah** terjadi — Anda sudah bayar sendiri, minta reimburse) atau `/finance/cash-advances` (untuk **kas bon**, minta uang muka **sebelum** aktivitas).

Expense:

1. Pilih **project**.
2. Pilih **category** (Transport / Meals / Lodging / Supplies / dsb).
3. Isi **amount** IDR.
4. Isi **incurred_at** (tanggal transaksi, bukan hari ini).
5. **Upload receipt** (nota / struk) — wajib.
6. Isi **description**.
7. Submit → chain sesuai nominal.

Cash Advance:

1. Pilih **type**: `GENERAL` (bebas) atau `FIELD_OPS` (untuk kunjungan lapangan).
2. Pilih **project** dan **amount**.
3. Isi **purpose** dan **estimated activity date**.
4. Submit → chain sesuai nominal.

**Untuk Field Ops**: Setelah Finance disburse, Anda punya **10 hari
kalender** untuk **settle** (upload nota + isi total actual). Anda
akan dapat reminder di hari -3, 0, +1, +3, +7. Kalau lewat +7 hari,
Supervisor / PM / OM akan di-eskalasi.

### Settle kas bon

`/finance/cash-advances/[id]` → **Settle**

1. Upload semua nota / struk (bisa multiple).
2. Isi **actual total spent**.
3. Submit → status `SETTLING`, menunggu Finance finalize.
4. Kalau `actual < disbursed`: sisa uang harus dikembalikan ke kas.
5. Kalau `actual > disbursed`: Anda dapat reimbursement top-up.

Finance boleh minta revisi (mis. nota tidak jelas atau tidak match).

---

## Supervisor

**Role**: `SUPERVISOR`. Approver L1 untuk banyak items.

### Daily checklist

- Buka **`/approvals`** — inbox unified. Filter default: item yang butuh Anda.
- Sekilas: setiap expense L1 harus verify context — "apakah bawahan saya benar melakukan aktivitas ini?"

### Approve / reject item

1. Klik item di inbox → detail drawer terbuka.
2. Baca description + attachment (receipt).
3. Klik **Approve** → item lanjut ke L2 (PM).
4. Klik **Reject** → wajib isi **reason** (min 10 karakter). Reason
   tercatat di audit — jangan reject tanpa alasan konkret.

### Reject dengan reason yang baik

**Buruk**: "Tidak setuju."
**Bagus**: "Nota tidak jelas, tanggal transaksi tidak match dengan jadwal kunjungan (2026-08-05 vs schedule 2026-08-04)."

### Handling HR Request

L1 Supervisor approve untuk `LEAVE` / `OVERTIME` / `SICK`. Untuk sick,
**verify surat dokter** — attachment PDF ada di detail page.

### Field Ops Cash Advance

Supervisor **selalu** di rung 0 untuk `ca_type = FIELD_OPS` — karena
Anda yang initiate field visit. Even amount kecil, tetap perlu approval
Anda. Pastikan trip legitimate + kas bon amount reasonable.

---

## Project Manager

**Role**: `PROJECT_MANAGER` (canonical `PM`).

### Daily checklist

- Cek dashboard proyek Anda di `/projects/[id]` — health status, budget utilization, milestone progress.
- Buka `/approvals` — approve L2 expense/CA/budget request.
- Cek `/hr/timesheets/weekly` untuk approve packet mingguan tim Anda.

### Manage project

`/projects/[id]`:

- **Update progress %**: manual, per feeling atau derived dari milestones DONE / total.
- **Add milestone**: dengan due date + description. Ketika di-set `DONE` / `AT_RISK`, otomatis notify client via portal.
- **Assign employee**: dropdown employee → set `allocation_percentage`. Sistem cek 100% sum lintas proyek.
- **Log project issue**: kalau ada masalah, log di `/projects/[id]/issues` dengan severity yang tepat. Critical dan High memicu SLA tight.

### Approve budget request

Kalau tim / OM ajukan Budget Request `INCREASE`, Anda approve L2 (di
threshold 5jt ke atas).

**Sebelum approve**:
- Baca **justification** — apakah reasonable?
- Cek current **utilization** — apakah kategori target memang kritis?
- Cek dampak ke **total budget** vs original proyek.

Setelah semua approver approve, Finance akan `apply()` untuk actually
memodifikasi angka budget.

### Approve weekly timesheet packet

`/hr/timesheets/weekly` → filter "Pending my approval"

1. Klik packet → detail week Senin-Minggu.
2. Review setiap entry: hours + project + description.
3. Klik **Approve packet** → semua 7 entry sekaligus jadi APPROVED.
4. Kalau ada 1 entry aneh, **Reject packet** dengan reason yang menunjuk hari + isu spesifik. Employee resubmit yang salah saja.

### PM handover — kalau Anda pergi cuti panjang / resign

`/handovers` → **New handover**

1. Pilih **outgoing PM** (Anda) dan **incoming PM** (yang menggantikan).
2. Set **handover date** (kapan effective).
3. Isi **reason** dan **notes** (task list yang masih ongoing).
4. Submit → OM Anda + Director approve.
5. Setelah `APPLIED`, semua pending approvals + tasks aktif otomatis pindah ke incoming PM.

---

## Operations Manager

**Role**: `OPERATIONS_MANAGER` (canonical `OM`). Membawahi beberapa PM.

### Daily checklist

- Cek dashboard executive: `/dashboard` — konsolidasi proyek lintas PM.
- Buka `/approvals` — approve L3 (mostly expenses/CA di atas 25jt), OM slot di CA Field Ops (≥ 20jt).
- Cek `/projects` — filter status ACTIVE — health per proyek.
- Approve PM Handover yang submit ke Anda.

### Cross-project decisions

Karena Anda melihat > 1 proyek, tanggung jawab spesifik:

- **Resource reallocation**: kalau PM proyek A butuh employee dari proyek B, koordinate + edit assignments.
- **Escalation dari Project Issues**: kalau issue past SLA level 3, Anda dinotifikasi. Take ownership atau assign.
- **Budget request Increase L3** (di atas 50jt kadang perlu Director juga).

### Approve PM Handover

Anda first-level approver untuk handover. Verify:

- Alasan valid (resign, rotasi, cuti panjang > 2 minggu).
- Incoming PM punya kapasitas (cek assignments-nya).
- Notes cukup detail — task list jangan ambigu.

Approve → lanjut ke Director.

---

## Head Manager / General Manager / Director

**Role**: `HEAD_MANAGER`, `GENERAL_MANAGER` (canonical: `DIRECTOR`).

### Daily checklist

- Cek dashboard konsolidasi di `/dashboard` — P&L per klien, gross margin BPO, SLA compliance.
- Buka `/approvals` — approve level tertinggi (nominal besar > 50jt / > 100jt).
- Review AI Insights di `/insights` — `ACTION_REQUIRED` prioritized.

### Strategic reviews

Fokus Anda bukan operational — tapi:

- **Budget Request DIRECTOR-level** — biasanya proyek revisi anggaran signifikan. Verify strategic alignment.
- **CA Field Ops ≥ 50jt** — biasanya trip besar (survey lapangan multi-hari, event, dsb).
- **PM Handover final approval** — cek reason dan replacement mature.

### Client health monitoring

`/dashboard` menampilkan **Client Health score** dari AI (aggregate SLA
compliance + response time + payment cycle). Klik client card → detail.

Kalau AI flag `SLA_BREACH_RISK` `ACTION_REQUIRED`, escalate ke OM /
PM terkait sebelum breach jadi kenyataan.

---

## Lead Finance

**Role**: `LEAD_FINANCE` (canonical `FINANCE`). **Gatekeeper cashflow.**

### Daily checklist

- Buka `/approvals` — filter "Finance gate". Anda gate semua chain
  finance.
- Cek **Cash Advance disbursements** — approved yang menunggu di-cair.
- Cek **CA settlements** — nota masuk dari employee.
- Cek **Petty Cash Replenishments** — request isi ulang dari custodian.
- Cek **Budget Requests** yang `PENDING_FINANCE` + siap `APPLIED`.
- Cek `/finance/expenses` — approve gate finance.

### Finance approve

Untuk semua item finance, sebelum Anda approve gate:

1. **Verify nota / receipt**: match tanggal, nominal, vendor.
2. **Verify budget availability**: kategori terkait di project budget masih ada saldo.
3. **Verify justification**: reason expense reasonable + ada corresponding project activity.

Kalau ada yang mencurigakan, **reject** dengan reason spesifik + tag PM untuk klarifikasi.

### Disburse Cash Advance

Setelah CA `APPROVED`, di detail page klik **Disburse**:

1. Verify **disbursed_amount** — biasanya = requested amount, tapi
   Anda boleh set kurang kalau ada alasan (mis. ada refund advance yang
   belum settle).
2. Klik **Disburse** → status `DISBURSED`, timer settlement mulai berjalan
   (untuk Field Ops: 10 hari kalender).
3. Uang cash / transfer keluar (proses eksternal — mungkin via bank atau kas kantor).

### Finalize Cash Advance Settlement

Setelah employee submit nota, item di `SETTLING`. Klik detail:

1. Preview semua nota upload.
2. Verify **actual_amount** dari nota.
3. Kalau semua OK → klik **Finalize** → status `SETTLED`, budget proyek
   otomatis terpotong `actual_amount`.
4. Kalau nota kurang / tidak jelas → klik **Request Revision** dengan
   reason. Employee dinotifikasi, resubmit.

### Apply Budget Request

Setelah budget request `APPROVED` (semua approver done):

1. Klik detail → **Apply**.
2. Preview perubahan: sebelum vs setelah (INCREASE `+10jt` di
   `DIRECT_LABOR`, dst).
3. Confirm → transaksi DB atomic: `budget_details.planned_amount` +
   `budgets.total_planned_amount` update sekaligus.

Sebelum Apply, angka budget belum berubah — Anda gerbang terakhir
sebelum "uang berubah di pembukuan".

### Petty Cash Replenishment

Custodian ajukan → Anda approve → disburse:

1. Verify **amount_requested** = `imprest_amount - current_balance`.
2. Approve → disburse (uang cash keluar untuk isi ulang).
3. Custodian confirm receipt → `current_balance` reset.

---

## Petty Cash Custodian

**Role**: `PETTY_CASH_CUSTODIAN` (canonical: `FINANCE`).

### Daily checklist

- Cek `/finance/petty-cash/[fund_id]` — saldo current.
- Approve voucher `PENDING_FINANCE` dari staff — atau delegate ke Lead Finance kalau di atas kapasitas Anda.
- Kalau saldo `< 20% imprest` → ajukan replenishment.
- Rekonsiliasi fisik kas + book setiap 3 hari (default).

### Buat voucher

`/finance/petty-cash/[fund_id]` → **New voucher**

1. Isi **amount**, **category**, **payee** (nama penerima cash).
2. Kalau amount ≥ Rp 100rb → **upload receipt** wajib.
3. Submit → sistem determine decision:
   - `< Rp 100rb`: auto-approved.
   - `Rp 100rb – < Rp 200rb`: auto-approved dengan receipt.
   - `Rp 200rb – Rp 2jt`: pending Finance approval.
   - `> Rp 2jt`: rejected, redirect ke expense flow.

### Reconciliation

Setiap N hari (default 3):

1. Hitung fisik kas di brankas.
2. Input **physical_count** di `/finance/petty-cash/[fund_id]/reconcile`.
3. Sistem compare vs **book_balance**. Selisih ≤ Rp 5rb → OK; di atas → variance investigation.

### Replenishment

Kalau `current_balance < min_balance_threshold` (default 20% imprest):

1. `/finance/petty-cash/[fund_id]` → **Replenish**.
2. `amount_requested` biasanya auto-fill ke `imprest_amount - current_balance`.
3. Submit → Finance approve → disburse.
4. Confirm receipt saat cash sampai di Anda → `current_balance` reset ke `imprest_amount`.

---

## HR Admin

**Role**: `HR_ADMIN` (canonical: `ADMIN`). **Final approver HR requests + Master HR keeper.**

### Daily checklist

- `/approvals` → filter HR — finalize `PENDING_HR_ADMIN` items.
- `/hr/requests` — cek in-flight requests.
- `/team` — maintain master karyawan.
- `/hr/payroll` — kalau akhir bulan, lock period + export CSV.

### Finalize HR request

Setelah Supervisor + PM + OM approve (untuk LEAVE/OT), atau Supervisor approve (untuk SICK):

1. Klik item → detail.
2. Verify **balance cuti** kalau LEAVE — sistem sudah check tapi verify lagi.
3. Verify **surat dokter** kalau SICK — legibility + tanggal match.
4. Klik **Approve** (finalize) → status `APPROVED`, side effects:
   - Roster otomatis update ke `LEAVE` / `SICK` untuk rentang.
   - Balance cuti dipotong (untuk LEAVE).
   - Employee dinotifikasi.
5. Kalau reject → reason spesifik.

### Kelola master karyawan

`/team`:

- **Hire baru**: fill full name, email (kalau butuh login), role, hourly_rate, hire_date. Sensitive PII (KTP, NPWP, salary, bank account) opsional tapi wajib untuk payroll.
- **Update**: setiap perubahan role atau salary tercatat di audit.
- **Terminate**: set `terminated_at`. Employee kehilangan akses login besok — semua data historical tetap ada.
- **Anonymize**: setelah 5 tahun terminated, cron auto-anonymize. Manual anonymize bisa juga (tombol khusus).

### Payroll lock + export

`/hr/payroll` → detail period akhir bulan (mis. Aug 2026)

1. Verify semua timesheet APPROVED — filter `pending` harusnya 0.
2. Cek **weekly_share_pct** — % hours dari weekly packet vs daily. Semakin tinggi, semakin baik process compliance.
3. Klik **Lock period** → freeze semua timesheet + HR requests untuk periode. Tidak bisa edit lagi kecuali unlock.
4. Klik **Export CSV** → download file untuk feed ke provider payroll eksternal (bank transfer, BPJS, PPh 21).

### Unlock (emergency)

Kalau ada correction dibutuhkan setelah lock:

1. Klik **Unlock period** → wajib isi **reason** (min 30 karakter).
2. Reason tercatat di audit — auditor pajak bisa question ini.
3. Setelah correction, **re-lock** immediately.

---

## Tenant Admin

**Role**: `TENANT_ADMIN` (canonical: `ADMIN`). **Highest privilege internal.**

### Daily checklist

- Tidak ada — Tenant Admin bukan operational. Bulanan:
  - Cek `/settings/secrets` → rotasi secret yang mendekati 90 hari.
  - Cek `/settings/archives` → verify cold archive integrity.
  - Cek `/dashboard` → executive metrics.

### Tambah user internal

Login sebagai `TENANT_ADMIN` → `/settings/users` → **Tambah pengguna**.
Tersedia dua metode:

**A. Kirim undangan (default, direkomendasikan)**

1. Pilih tab **Kirim undangan**.
2. Isi **email** kerja, **nama lengkap**, dan **role**.
3. Sistem membuat `employees` row + mengirim invitation email.
4. User klik link di email → set password sendiri → login melalui subdomain tenant.

**B. Buat manual (tanpa undangan)**

1. Pilih tab **Buat manual**.
2. Isi **email**, **nama lengkap**, dan **role**.
3. Pilih password sementara:
   - **Auto-generate** (direkomendasikan) — sistem membuat password acak 32 karakter.
   - **Custom** — admin mengisi password sementara minimal 12 karakter + konfirmasi.
4. Klik **Buat akun**. Akun langsung aktif (`email_confirm`) dan `employees` row dibuat dalam langkah yang sama; tidak ada email yang dikirim.
5. Panel sukses menampilkan URL login, email, dan password **satu kali**. Salin kredensial, serahkan melalui kanal aman, lalu centang konfirmasi sebelum menutup panel.
6. Minta user login melalui `https://<slug>.<root-domain>/login` dan mengganti password melalui **Profil → Ganti Password**.

Catatan keamanan mode manual:

- Hanya `TENANT_ADMIN` yang dapat memakai kedua metode (PDP `user_admin`).
- Password tidak pernah ditulis ke audit log; yang tercatat hanya email, nama, role, dan metode pembuatan.
- Satu email hanya dapat terdaftar satu kali di Supabase Auth. Email yang sudah dipakai di tenant lain akan ditolak.
- Jangan membuat user lebih dulu melalui HR → Karyawan dengan email yang sama — pembuatan login akan ditolak sebagai duplikat. Buat login terlebih dahulu, lalu lengkapi data HR pada row `employees` yang terbentuk.

### Invite client portal user

`/clients/[client_id]/portal-users` → **Invite user**

1. Isi email + display name.
2. Sistem generate **temp password** (16 chars random) → hash → insert dengan status `PENDING_ACTIVATION`.
3. **Temp password ditampilkan sekali** di dialog — copy + kirim ke klien via channel aman (WhatsApp Business, email pribadi PIC, dst).
4. Klien login → dipaksa change password sendiri → status ke `ACTIVE`.

Kalau klien lupa password: **Reset password** → sistem generate baru + status kembali ke `PENDING_ACTIVATION`. Kirim ulang temp password.

### Manage secrets

`/settings/secrets` — registry semua secret yang harus di-rotasi 90 hari:

- `APP_ENCRYPTION_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- SMTP credentials
- LLM API keys (kalau AI aktif)

Setiap secret tercatat `last_rotated_at`. Cron mingguan warn kalau
mendekati 90 hari, urgent kalau over. Rotasi manual:

1. Rotate di provider (Supabase dashboard, OpenAI dashboard, dst).
2. Update env di Vercel (production + staging).
3. `/settings/secrets` → klik **Mark rotated** untuk secret tersebut → wajib isi note.

Full runbook: [`../ops/secret-rotation.md`](../ops/secret-rotation.md).

### Data retention & archives

`/settings/archives` — registry cold archive:

- Registry setiap batch archive (project_expenses tahun N, security_audit_logs tahun N, dst).
- Preview manifest + verify SHA-256 checksum.
- Generate signed URL (TTL 5 menit) untuk download / restore.

Runbook: [`../ops/data-retention.md`](../ops/data-retention.md).

### Emergency: override approval

Kalau ada situasi darurat, ADMIN bisa **override approve** slot apa saja
di `/approvals`. Dialog akan minta reason. Audit trail flag `override:
true`.

Gunakan sparingly — every override audited dan dapat direview oleh
Director. Preferable: escalate ke role yang benar, bukan override.

---

## Common troubleshooting

### "Saya tidak melihat menu X"

Menu di sidebar difilter by role. Kalau Anda tidak melihat modul yang
seharusnya bisa Anda akses, kontak Tenant Admin — mungkin role Anda di
DB tidak sesuai ekspektasi.

### "Approval saya tidak jalan"

Kemungkinan:

1. **Chain butuh Anda tapi Anda tidak lihat di inbox** — refresh page (Cmd+R). Realtime kadang delay < 5 detik.
2. **Anda submit-nya sendiri** — no-self-approval rule. Item butuh approver lain.
3. **Item stuck di slot lain** — cek chain visualization di detail page, lihat siapa yang belum act.
4. **Kalau semua approver sudah setuju tapi tidak lanjut** — mungkin `apply()` (Budget Request) atau `finalize()` (CA Settlement) belum dijalankan oleh Finance.

### "Saya lupa password"

Klik **Forgot password** di login page. Reset link dikirim ke email.
Kalau email tidak sampai, kontak Tenant Admin — dia bisa manually reset.

### "Session saya expired"

Session Supabase default 1 jam sliding. Setelah 1 jam idle, Anda
di-logout otomatis. Re-login.

### "Data yang saya expect tidak muncul"

Cek:

1. Anda di subdomain yang benar? Multi-tenant — kalau salah subdomain, Anda lihat data tenant lain / kosong.
2. Filter aktif di halaman list? Reset filter (biasanya tombol clear di header table).
3. Anda punya akses ke resource ini? Role filter mungkin hide row.

### "Saya mau report bug"

Screenshot + langkah reproduce → kirim ke Tenant Admin atau
`support@controldesk.app`. Sertakan **timestamp** dan **request-id**
yang muncul di error page (untuk cross-ref di logs).

---

## Where to look next

- Detail modul yang Anda pakai → [`../modules/`](../modules/).
- Approval workflow lengkap → [`../product/approval-workflows.md`](../product/approval-workflows.md).
- Glossary istilah → [`../product/glossary.md`](../product/glossary.md).
- Untuk klien Anda: [`client-portal-users.md`](client-portal-users.md).
