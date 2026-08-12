# Manual smoke scripts & release checklist

Skenario **manual** yang dijalankan human sebelum release ke staging /
production. Complement CI automation dengan hal yang **tidak** cocok
di-automate: cross-browser, real device, visual polish, screen reader,
data-heavy exploration.

## Kapan pakai doc ini

| Situasi                                       | Yang di-jalankan                                             |
| --------------------------------------------- | ------------------------------------------------------------ |
| PR touch fitur user-facing                    | Section [Per-module smoke](#per-module-smoke) untuk module tersebut. |
| Sebelum merge ke `main`                       | Full [Pre-merge checklist](#pre-merge-checklist).            |
| Sebelum deploy staging                        | [Release checklist — staging](#release-checklist-staging).   |
| Sebelum deploy production                     | [Release checklist — production](#release-checklist-production). |
| Weekly regression                             | Section [Weekly regression](#weekly-regression) — 30 menit.  |
| Bug hunt (S0 escalation)                      | Adhoc — pakai [`bug-reporting.md`](bug-reporting.md).        |

## Pre-merge checklist (per PR)

Sebelum click **Merge** button pada PR:

- [ ] Semua CI check hijau (`ci`, `e2e`, `security`, `docker` kalau relevan).
- [ ] Reviewer approve.
- [ ] Kalau touch UI: manual smoke module yang relevan (di bawah).
- [ ] Kalau touch schema: `pnpm db:reset` sukses lokal.
- [ ] Kalau touch security helpers: coverage ≥ 80 % tetap.
- [ ] Kalau touch i18n: verify parity test hijau + toggle EN ↔ ID di UI.
- [ ] Kalau touch cron: verify manual trigger lokal (`curl` dengan `CRON_SECRET`).
- [ ] Kalau touch API route: verify `/api/health` masih 200.

## Per-module smoke

Setiap module ada script ~5 menit yang cover happy path + 1-2 edge
case. Jalankan setelah code change di module tersebut.

Prasyarat semua script: `pnpm db:reset` clean + `pnpm dev` running.

### Auth

**Login happy path** (2 menit):

1. Buka `http://demo.localhost:3000/login`.
2. Isi email `pm@demo.controldesk.app`, password `ControlDesk#2026`.
3. Klik **Sign in**.
4. Verify redirect ke `/dashboard`, header show "Putri PM".
5. Verify sidebar tampilkan menu sesuai role PM (Projects, Approvals, dst).
6. Click **Sign out** di user menu → redirect balik ke `/login`.

**Wrong password guard** (1 menit):

1. Login dengan password salah.
2. Verify alert error dwibahasa muncul (ID atau EN sesuai locale).
3. Verify NO redirect ke `/dashboard`.

**Cross-tenant guard** (2 menit):

1. Login as `admin@demo.controldesk.app` di `demo.localhost:3000`.
2. Try navigate ke tenant lain — buka `http://acme.localhost:3000/dashboard` (dengan asumsi ada tenant `acme` — kalau tidak, skip).
3. Verify sign-in prompt / access denied — tidak boleh auto-authenticated.

### Client management

**Client list + detail** (3 menit):

1. Login as `admin`.
2. Navigate `/clients`.
3. Verify list: PT Nusa Digital, PT Indo Retail Ceria, PT Sejahtera Media (3 client).
4. Click PT Nusa Digital → detail page.
5. Verify tab **Projects** show NUSA-CS, NUSA-DATA.
6. Verify tab **Contracts** show BPO contract detail (MRR, term, SLA).
7. Verify tab **Portal Users** show 2 portal users (Nusa client + newbie).

**New client** (4 menit):

1. `/clients` → **New Client** button.
2. Fill slug, name, tax ID, contact email + name.
3. Click **Save**.
4. Verify redirect ke detail page baru, empty projects tab.

**Portal user CRUD** (5 menit):

1. `/clients/{PT Nusa id}/portal-users`.
2. Click **Invite** → fill email `qa-test@example.com`, submit.
3. Verify dialog show **one-time temporary password** — copy it.
4. Refresh page → verify row baru dengan status **Pending activation**.
5. Click **Reset password** → verify new temp password shown.
6. Click **Disable** → verify status berubah + row grayed out.
7. Klik **Enable** → verify status kembali.

### Project management

**Project detail + milestones** (3 menit):

1. Login as `pm`.
2. `/projects` → click NUSA-CS.
3. Verify header: code, name, client, status.
4. Verify Milestones tab: list milestones dengan status pill (PLANNED / IN_PROGRESS / DONE / AT_RISK).
5. Click milestone → edit status ke IN_PROGRESS → save.
6. Verify pill berubah instant.
7. Verify audit log tambah row baru (via Supabase Studio kalau audit UI belum ada).

**Project issues** (3 menit):

1. `/projects/{NUSA-CS id}/issues` (or via nav).
2. Verify list: seeded issues + SLA countdown badge.
3. Click **New Issue** → severity Critical, submit.
4. Verify SLA badge default 1 jam business-hours untuk Critical.
5. Kalau ada issue overdue: verify escalation badge (arrow up icon).

### Finance — Cash Advance

**Full chain walk** (10 menit) — mirror `cash-advance-chain.spec.ts`:

Prasyarat: `pnpm db:reset` fresh state.

1. Login as `supervisor` → `/finance/cash-advances/66666666-1111-4111-8111-111111111111`.
2. Verify status "Pending L1 · Supervisor" + Approve button visible.
3. Click **Approve** → **Confirm approve**.
4. Verify status berubah ke "Pending L2 · Project Manager".
5. Sign out. Login as `pm` → back to CA URL.
6. Approve L2.
7. Sign out. Login as `finance` → back to CA URL.
8. Approve L2.5 → verify status "Awaiting disbursement".
9. Click **Disburse** → fill ref `MANUAL-QA-001` → confirm.
10. Verify status "Disbursed · Awaiting settlement".
11. Sign out. Login as `employee` (requester) → back to CA URL.
12. Submit settlement dengan total spent 1.5jt.
13. Sign out. Login as `finance` → back to CA URL.
14. Accept settlement → verify status "Settled".
15. Verify no more action buttons (terminal state).

**Access-control denials** (3 menit):

1. Reset DB (kalau baru walk chain).
2. Login as `employee` → CA URL (PENDING).
3. Verify NO Approve / Disburse button visible.
4. Login as `supervisor` → CA URL after Finance approve.
5. Verify NO Disburse button (only Finance can disburse).

### Finance — Petty Cash

**Voucher submit + auto-approve** (5 menit):

1. Login as `pettycash`.
2. `/finance/petty-cash` → verify fund balance display.
3. Click **New Voucher** → fill category, amount 500rb, receipt upload.
4. Submit.
5. Verify voucher tampil di list dengan status APPROVED (auto-approve < 1jt).

**Replenishment** (3 menit):

1. Login as `pettycash`.
2. Kalau fund near threshold: click **Request Replenishment**.
3. Fill amount → submit.
4. Sign out. Login as `finance`.
5. Navigate ke replenishment approval → approve.
6. Verify fund balance restored.

### Finance — Budget Request

**Increase budget request** (5 menit):

1. Login as `pm`.
2. Navigate ke `/finance/budget-requests` → click **New Request**.
3. Kind: INCREASE, project NUSA-CS, amount 10jt, justification "extended scope".
4. Submit.
5. Verify status "Pending L2 · PM" atau langsung Finance sesuai config PM own approval.
6. Sign out → login as `finance` → approve.
7. Verify status berubah ke APPROVED lalu langsung APPLIED (transaction: `budgets.total_planned_amount` naik).

### HRIS — Leave

**LEAVE full 4-hop chain** (10 menit) — mirror `hr-leave-chain.spec.ts`:

Prasyarat: `pnpm db:reset` fresh.

1. Login as `supervisor` → `/hr/requests/55555555-1111-4111-8111-111111111111`.
2. Verify status "Pending L1 · Supervisor" + Approve.
3. Approve. Verify → "Pending L2 · Project Manager".
4. Login as `pm`, approve. → "Pending L3 · Operations Manager".
5. Login as `om`, approve. → "Pending HR Admin".
6. Login as `hr`, approve. → **APPROVED**.
7. Verify approval chain visualization (green pill on each slot).

**Access-control** (2 menit):

1. Login as `employee` (requester) → LEAVE URL.
2. Verify NO Approve / Reject button (requester tidak di chain sendiri).
3. Login as `finance` → LEAVE URL.
4. Verify NO Approve button (finance bukan di HR chain).

### HRIS — Weekly Timesheet

**Weekly packet submit + approve** (5 menit) — mirror `weekly-timesheet.spec.ts`:

1. Login as `employee`.
2. `/hr/timesheets/weekly` → verify current week form.
3. Isi jam kerja per hari (misal 8-8-8-8-8 = 40 jam).
4. Click **Submit for Approval**.
5. Verify status "SUBMITTED" + read-only.
6. Sign out → login as `pm`.
7. Navigate ke approvals inbox → filter weekly.
8. Klik packet → verify detail per hari.
9. Approve.
10. Verify status "APPROVED" + cascade ke daily entries semua APPROVED.

### HRIS — Payroll

**Payroll period + DLC** (3 menit):

1. Login as `hr` atau `finance`.
2. `/hr/payroll` → verify list periode + Direct Labor Cost total.
3. Click periode terbaru → verify per-employee breakdown.
4. Verify "Weekly share" badge — % dari jam approved via weekly packet.
5. Klik export CSV (kalau ada) → verify download.

### Approvals Inbox

**Unified inbox realtime** (5 menit):

1. Login as `finance` di window 1.
2. `/approvals` → note item count di badge.
3. Buka window 2 (incognito), login as `supervisor`.
4. Buat expense baru via `/finance/expenses/new` → submit (masuk L1 supervisor).
5. Approve as supervisor → next state L2 PM (Finance TIDAK muncul disini kalau amount < threshold Finance).
6. Kalau approval sampai finance level, verify di window 1 badge count naik **tanpa refresh** (realtime).

### Client Portal

**Portal login + isolation** (10 menit) — mirror `portal.spec.ts`:

1. Buka `http://demo.localhost:3000/portal/login`.
2. Login as `client@demo.controldesk.app` (Nusa).
3. Verify dashboard show "PT Nusa Digital" heading + list NUSA-CS + NUSA-DATA (bukan INDO-HELP).
4. Click NUSA-CS → project detail.
5. Verify sections: Summary, Milestones timeline, Financials.
6. Verify Financials show budget total, spent, remaining — TAPI **tidak** list per-expense (kontrak dengan client tidak leak internal detail).
7. Sign out.
8. Login as `client-indo@demo.controldesk.app` (Indo).
9. Verify dashboard show ONLY INDO-HELP (bukan Nusa projects).
10. Force navigate ke `/portal/projects/{NUSA-CS id}` — verify 404 (bukan project detail Nusa).

**Force change password** (5 menit):

1. Login as `client-new@demo.controldesk.app` (PENDING_ACTIVATION).
2. Verify automatic redirect ke `/portal/change-password`.
3. Try navigate ke `/portal` — verify redirect balik ke change-password.
4. Isi current password `ControlDesk#2026`, new password `NewSecure#2026`, confirm.
5. Submit → verify redirect ke `/portal` dashboard, status "Active".
6. Sign out + login lagi dengan `NewSecure#2026` — verify success.

**Notifications** (3 menit):

1. Login as `client@demo.controldesk.app` (Nusa).
2. Verify bell icon di topbar dengan unread badge count.
3. Click bell → dropdown show recent notifications.
4. Click notifikasi → detail page + auto mark-read.
5. `/portal/notifications` → full feed + "Mark all as read" button.

### Insights (AI)

**Insight page role gate** (3 menit):

1. Login as `pm` → `/insights`.
2. Verify list 4 insight card (expense impact, resource utilization, client health, SLA breach).
3. Klik expense impact → verify content + AI-generated summary.
4. Sign out. Login as `employee` → `/insights`.
5. Verify NO access (redirect atau access denied) — insights role-gated.

## Weekly regression

30 menit — dijalankan setiap Jumat sebelum weekend deploy freeze.

1. `pnpm db:reset` fresh.
2. Full `pnpm test:e2e` locally.
3. Manual: auth login + role gating (5 menit).
4. Manual: CA chain (10 menit).
5. Manual: LEAVE chain (5 menit).
6. Manual: portal isolation (5 menit).
7. Manual: approvals inbox realtime (5 menit).
8. File any regression ke Linear / GitHub Issues dengan label `weekly-regression`.

## Release checklist — staging

Dilakukan setiap deploy ke `staging.controldesk.app`.

### Pre-deploy

- [ ] All CI check green pada commit di `main` yang akan di-deploy.
- [ ] `CHANGELOG.md` updated dengan entry release ini.
- [ ] Environment variables verified di Vercel staging (mirror production shape).
- [ ] Migration baru tested lokal (`pnpm db:reset` sukses).
- [ ] Rollback plan documented — commit SHA sebelumnya di tangan.

### Deploy

- [ ] Trigger deploy via GitHub Actions atau `vercel deploy` staging.
- [ ] Monitor build log — no error.
- [ ] Apply migration ke staging DB (`supabase link` → `supabase db push`) kalau ada migration baru.

### Post-deploy smoke (10 menit)

- [ ] `/api/health` → 200 OK.
- [ ] `/api/ready` → 200 OK (DB + Redis reachable).
- [ ] `/api/version` → correct commit SHA.
- [ ] Login as `admin@staging.controldesk.app` (staging seed) sukses.
- [ ] Dashboard load — no error di browser console.
- [ ] Buka Datadog / Sentry — no new error spike 5 menit pertama.
- [ ] Manual CA chain first 2 steps (Supervisor + PM approve) — verify audit log tercatat.

### Sign-off

- [ ] QA Lead sign-off di release ticket.
- [ ] Notify #releases channel dengan link ke commit + release notes.

## Release checklist — production

Setelah staging soak minimum **24 jam** tanpa new error, promote ke production.

### Pre-deploy

- [ ] Staging soak sudah minimum 24 jam.
- [ ] Zero P0/P1 bug open dari staging QA.
- [ ] All secret di production Vercel verified (rotasi < 90 hari).
- [ ] Production DB backup fresh (< 6 jam terakhir).
- [ ] Cron jobs di `vercel.json` verified — no unexpected schedule.
- [ ] Rollback SHA + procedure documented di release doc.

### Deploy

- [ ] Deploy production via GitHub Actions atau `vercel deploy --prod`.
- [ ] Apply migration ke production DB dengan **DBA present**.
- [ ] Monitor deploy log real-time.
- [ ] Traffic gradual ramp-up kalau feature flag / canary tersedia (currently manual).

### Post-deploy production smoke (20 menit)

- [ ] `/api/health` → 200 OK.
- [ ] `/api/ready` → 200 OK.
- [ ] `/api/version` → correct commit SHA.
- [ ] Login sebagai internal test user production sukses.
- [ ] Random real tenant subdomain load OK (bukan demo).
- [ ] Klien portal test user login sukses (kalau ada).
- [ ] Datadog dashboard: request rate, error rate, p95 latency — no anomaly.
- [ ] Sentry: no new error 15 menit pertama.
- [ ] Kalau ada cron: verify jadwal Vercel Cron aktif.

### Rollback trigger

**Rollback IMMEDIATELY** kalau salah satu:
- Error rate spike > 5 % dari baseline.
- p95 latency > 2× baseline sustain > 5 menit.
- Any S0 bug reported dalam 30 menit post-deploy.
- Cross-tenant data leak / auth bypass observed.

Prosedur rollback:
1. `vercel rollback` ke commit SHA sebelumnya (immediate).
2. Kalau migration di-apply: check apakah reversible — kalau tidak, coordinate dengan DBA.
3. Post-mortem di doc `docs/incidents/YYYY-MM-DD.md`.

### Sign-off

- [ ] Tech Lead + QA Lead + Product Owner sign-off.
- [ ] Notify #general channel + email customer-facing kalau ada breaking change.
- [ ] Release notes published (public changelog atau internal).

## Cross-browser + device manual (per release)

Automation cuma Chromium desktop. Manual verify:

### Browsers (setiap release)

- [ ] **Safari** (latest macOS) — login + dashboard render.
- [ ] **Firefox** (latest) — same.
- [ ] **Edge** (latest Windows) — same.

Focus area yang beda:
- Date picker rendering.
- File upload drag-drop.
- Copy-to-clipboard behavior.
- Font rendering (weight, spacing).

### Devices (setiap release major)

- [ ] **iPhone Safari** — portal login + dashboard responsive.
- [ ] **Android Chrome** — same.
- [ ] **iPad** — sidebar collapse behavior.

Focus:
- Touch targets minimum 44×44 px.
- Modal / sheet berfungsi di mobile viewport.
- Sidebar collapse + expand smooth.

## Where to look next

- Bug filing → [`bug-reporting.md`](bug-reporting.md).
- Accessibility → [`accessibility-testing.md`](accessibility-testing.md).
- Automated E2E → [`e2e-playbook.md`](e2e-playbook.md).
