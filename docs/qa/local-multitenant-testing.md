# Local multi-tenant testing runbook

Panduan **hands-on** untuk QA / dev yang perlu memverifikasi
tenant-isolation, RLS, self-signup, super-admin, dan feature flags di
mesin lokal — **tanpa perlu edit `/etc/hosts`**, tanpa perlu DNS
custom, hanya `docker compose up` + browser.

> **Untuk siapa**:
>
> 1. QA yang test regresi sebelum release.
> 2. Dev yang implementasi feature baru dan perlu smoke-test isolation.
> 3. Ops yang mereproduksi bug customer di lokal sebelum push fix.
> 4. Onboarding contributor baru — pahami "cara jalanin app multi-tenant".

Doc pelengkap:

- [`../ops/tenant-provisioning.md`](../ops/tenant-provisioning.md) — cara provision tenant (CLI, UI, self-signup, SQL).
- [`e2e-roleplay.md`](e2e-roleplay.md) — persona-driven testing di dalam satu tenant.
- [`e2e-playbook.md`](e2e-playbook.md) — Playwright config + debug flow.
- [`../product/roles-and-permissions.md`](../product/roles-and-permissions.md) — legal permission per role.

## Table of contents

- [TL;DR — URL cheatsheet](#tldr--url-cheatsheet)
- [Prasyarat lokal](#prasyarat-lokal)
- [Skenario A — Login sebagai tenant admin (`demo`)](#skenario-a--login-sebagai-tenant-admin-demo)
- [Skenario B — Super-admin panel (di apex)](#skenario-b--super-admin-panel-di-apex)
- [Skenario C — Self-signup end-to-end (Fase 6.1)](#skenario-c--self-signup-end-to-end-fase-61)
- [Skenario D — Bulk feature-flag toggle (Fase 6.2)](#skenario-d--bulk-feature-flag-toggle-fase-62)
- [Skenario E — Suspend tenant + trial banner](#skenario-e--suspend-tenant--trial-banner)
- [Skenario F — Create tenant via CLI](#skenario-f--create-tenant-via-cli)
- [Isolation stress-test — SQL](#isolation-stress-test--sql)
- [Rate-limit test — self-signup abuse](#rate-limit-test--self-signup-abuse)
- [Playwright E2E — automated smoke](#playwright-e2e--automated-smoke)
- [Gotcha lokal — cheat sheet](#gotcha-lokal--cheat-sheet)
- [One-shot cleanup](#one-shot-cleanup)

## TL;DR — URL cheatsheet

| Surface | URL | Kredensial |
| --- | --- | --- |
| Marketing / apex | `http://localhost:3000/` | — (public) |
| Public self-signup | `http://localhost:3000/register-org` | — (public) |
| Super-admin panel | `http://localhost:3000/super-admin` | Platform admin (§Skenario B) |
| Tenant `demo` | `http://demo.localhost:3000/` | Seed users (§`e2e-roleplay.md`) |
| Tenant hasil signup | `http://{slug}.localhost:3000/` | Dari email verifikasi |
| Mailpit inbox | `http://localhost:8025/` | — |
| Supabase Studio | `http://localhost:54323/` | — |
| Prod container (Docker) | `http://localhost:3001/*` (subdomain juga) | Sama dengan dev |

**Cara subdomain jalan tanpa `/etc/hosts`**: modern browser
(Chrome / Firefox / Safari sejak ~2018) auto-resolve `*.localhost`
→ `127.0.0.1` sesuai [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761).
Ketik `demo.localhost:3000` di URL bar dan langsung nyambung. Kalau
gagal (Safari lama, WSL, custom DNS), tambah manual ke `/etc/hosts`:

```bash
sudo tee -a /etc/hosts <<'HOSTS'
127.0.0.1 demo.localhost
127.0.0.1 acme.localhost
127.0.0.1 alpha.localhost
HOSTS
```

## Prasyarat lokal

Cek semua services jalan dengan satu command:

```bash
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep supabase
```

Yang harus **healthy**:

- `controldesk-app` — Next.js container (prod build) di `:3001` (atau `pnpm dev` di `:3000`).
- `controldesk-mailpit` — SMTP mock di `:1025`, UI `:8025`.
- `controldesk-redis` — rate-limit store di `:6379`.
- `supabase_db_controldesk` — Postgres di `:54322`.
- `supabase_inbucket_controldesk` — Supabase's own mock SMTP di `:54325` (opsional).

Kalau ada yang mati:

```bash
docker compose up -d
supabase start   # kalau supabase local belum jalan
```

Untuk dev-mode (hot reload):

```bash
pnpm dev   # menjadi :3000, container di :3001 tetap running paralel
```

## Skenario A — Login sebagai tenant admin (`demo`)

Verifikasi tenant-isolation, RLS, dan navigation dasar.

1. Buka `http://demo.localhost:3000/login`.
2. Login pakai `admin@demo.controldesk.app` / `ControlDesk#2026`
   (seed password — lihat `supabase/seed.sql` line 1).
3. Verifikasi:
   - Sidebar tampilkan menu sesuai role `TENANT_ADMIN`.
   - Semua data (projects, employees, expenses) di-scope ke
     `tenant_id=demo` via RLS.
   - Trial banner **tidak** muncul (seed set `trial_ends_at=NULL`).

Untuk switch persona lain (Supervisor, Finance, PM, dll.) — lihat
[`e2e-roleplay.md`](e2e-roleplay.md).

## Skenario B — Super-admin panel (di apex)

Verifikasi platform admin claim + cross-tenant view.

Platform admin yang sudah ter-provision (via migration 0077 +
`supabase/seed.sql`): **`admin@demo.controldesk.app`**. Perhatikan:
akun ini **dual-role** — sekaligus `TENANT_ADMIN` di tenant demo DAN
platform admin di apex.

1. Buka `http://localhost:3000/login` (perhatikan: apex, **bukan**
   `demo.localhost:3000`).
2. Login pakai `admin@demo.controldesk.app` / `ControlDesk#2026`.
   Kalau lupa password:

   ```bash
   docker exec supabase_db_controldesk psql -U postgres -d postgres \
     -c "update auth.users set encrypted_password = crypt('ControlDesk#2026', gen_salt('bf')) where email = 'admin@demo.controldesk.app';"
   ```

3. Otomatis redirect ke `/super-admin/tenants`.
4. Verifikasi tab tersedia: **Tenants** · **+ New tenant** ·
   **Bulk features** · **Admins**.
5. Klik salah satu tenant → panel `Suspend/Reactivate` + `Feature
   flags` + `Recent audit` muncul.

**Sanity check di DB**:

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres -tAc \
  "select user_id::text, email, is_active from public.platform_admins;"
```

## Skenario C — Self-signup end-to-end (Fase 6.1)

Alur paling kompleks — full test tenant self-service tanpa keluar
dari lokal. Estimasi waktu: **~2 menit**.

**Step 1 — Isi form**

1. Buka `http://localhost:3000/register-org` (apex, tanpa login).
2. Isi:
   - **Nama organisasi**: `PT Acme Test`.
   - **Slug workspace**: `acme-test` (2–63 char, lowercase, tidak reserved).
   - **Email admin**: `test@example.com` (tidak perlu real — mailpit
     tangkap semua).
   - **Nama admin**: `Budi Tester`.
3. Klik **Daftar & kirim link verifikasi**.
4. Screen berubah jadi "Periksa email Anda".

**Step 2 — Ambil verify link dari mailpit**

1. Buka `http://localhost:8025/`.
2. Klik email teratas: **"Konfirmasi pendaftaran PT Acme Test di ControlDesk"**.
3. Copy URL yang berbentuk
   `http://localhost:3000/register-org/verify/{TOKEN}`.

**Step 3 — Verify + auto-provision**

1. Paste URL ke browser. RSC pipeline eksekusi:
   - Hash raw token → cari row `tenant_signup_requests`.
   - Reject kalau expired (24h) / sudah verified / slug keburu dipakai.
   - `auth.admin.createUser` — buat user + password random.
   - RPC `complete_tenant_signup()` → tenants row + CoA seed (~45 akun)
     + admin employee + audit log.
   - Set `plan='trial'` + `trial_ends_at = now() + 14 days` +
     `provisioned_via='self-signup'`.
   - Kirim email kredensial.
2. Halaman confirmation muncul dengan:
   - URL login `http://acme-test.localhost:3000/login`.
   - Email admin (copyable).
   - **Password sementara** (copyable — hanya ditampilkan sekali!).
3. Cek mailpit lagi — ada email kedua **"Workspace PT Acme Test siap"**
   yang berisi kredensial (fallback kalau customer close tab tanpa copy).

**Step 4 — Login ke tenant baru**

1. Klik **Login ke workspace →** atau paste URL login manual.
2. Login pakai kredensial dari confirmation page.
3. Verifikasi:
   - Trial banner **indigo** di top: "Uji coba **14 hari lagi**
     (berakhir DD Month YYYY)".
   - Sidebar muncul (role admin — akses full).
   - `chart_of_accounts` sudah ter-seed 45 akun default.

**Step 5 — Verifikasi isolasi via SQL**

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres <<'SQL'
-- 1. Semua tenant — harusnya ada demo + acme-test dengan provisioned_via yang benar
select slug, name, status, plan, trial_ends_at::date, provisioned_via
from public.tenants order by created_at;

-- 2. CoA per tenant — harus TERPISAH (masing-masing ~45 akun default)
select t.slug, count(c.id) as coa_count
from public.tenants t
left join public.chart_of_accounts c on c.tenant_id = t.id
group by t.slug order by t.slug;

-- 3. Audit trail signup requests
select slug, admin_email,
       verified_at is not null as verified,
       verified_tenant_id is not null as provisioned
from public.tenant_signup_requests order by created_at desc limit 3;
SQL
```

## Skenario D — Bulk feature-flag toggle (Fase 6.2)

Setelah punya minimal 2 tenant:

1. Login sebagai platform admin di `http://localhost:3000/super-admin`.
2. Klik tab **Bulk features**.
3. Tiap kartu feature tampilkan **effective ON %** + stats:
   Explicit ON · Explicit OFF · Default.
4. Test canary flow:
   - Pilih feature (misal `google_calendar_sync`).
   - Mode: **Canary: pilih slug spesifik**.
   - Isi slug: `acme-test` (comma-separated multiple).
   - Aksi: **Set ke ON**.
   - Klik **Terapkan…** → panel konfirmasi.
   - Isi catatan audit: `canary rollout untuk tenant baru`.
   - Konfirmasi → response `bulk_run_id: {UUID}`.

**Verifikasi audit log**:

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres -c \
  "select target_tenant_id, old_values, new_values, metadata->>'bulk_run_id' as bulk_run_id, metadata->>'notes' as notes, created_at from public.platform_admin_audit_logs where resource_name = 'tenant_feature_flags' order by created_at desc limit 5;"
```

Setiap tenant yang di-flip = **satu row audit terpisah** dengan
`bulk_run_id` yang sama untuk reconciliation.

## Skenario E — Suspend tenant + trial banner

**Suspend flow**:

1. `/super-admin/tenants/{id}` → panel **Status** → **Suspend**
   → alasan wajib (≥3 karakter).
2. Buka `http://acme-test.localhost:3000/` di **incognito** (hindari
   cache session) → proxy rewrite ke `/suspended`.
3. Reactivate via panel yang sama → app kembali normal.

**Force trial expiry** (test banner rose state):

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres \
  -c "update public.tenants set trial_ends_at = now() - interval '2 days' where slug = 'acme-test';"
```

Login lagi → banner rose "Uji coba **berakhir 2 hari lalu**".

**Force trial urgent** (test banner amber state, ≤3 hari):

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres \
  -c "update public.tenants set trial_ends_at = now() + interval '2 days' where slug = 'acme-test';"
```

**Restore ke trial normal**:

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres \
  -c "update public.tenants set trial_ends_at = now() + interval '14 days' where slug = 'acme-test';"
```

## Skenario F — Create tenant via CLI

Untuk scripted / batch onboarding — bypass UI + email verification:

```bash
pnpm tenant:create \
  --slug=alpha \
  --name="PT Alpha Test" \
  --admin-email=alpha@example.com \
  --admin-name="Ani Alpha" \
  --yes
```

Output: tenant_id, temporary password, rendered welcome email body
di stdout. Tenant otomatis punya `plan='trial'` +
`provisioned_via='ops-cli'`.

Untuk sekaligus kirim email via mailpit:

```bash
pnpm tenant:create --slug=alpha --name="PT Alpha" \
  --admin-email=alpha@example.com --admin-name="Ani Alpha" \
  --send-email --yes
```

Cek mailpit di `http://localhost:8025/` — welcome email harus muncul.

## Isolation stress-test — SQL

Skenario paling penting untuk validasi RLS + tenant_id filtering.
**Impersonate** authenticated user dari tenant demo, lalu SELECT
semua tabel — hasil harus **hanya data demo**, tidak pernah leak ke
tenant lain:

```bash
DEMO_ID=$(docker exec supabase_db_controldesk psql -U postgres -d postgres -tAc "select id from public.tenants where slug='demo';")
DEMO_USER=$(docker exec supabase_db_controldesk psql -U postgres -d postgres -tAc "select user_id from public.employees where role='TENANT_ADMIN' and tenant_id='$DEMO_ID' limit 1;")

docker exec supabase_db_controldesk psql -U postgres -d postgres <<SQL
set request.jwt.claims = '{"role": "authenticated", "sub": "$DEMO_USER", "tenant_id": "$DEMO_ID"}';
set role authenticated;

select 'projects'          as tbl, count(*) from public.projects
union all
select 'chart_of_accounts', count(*) from public.chart_of_accounts
union all
select 'employees',         count(*) from public.employees
union all
select 'project_expenses',  count(*) from public.project_expenses;

reset role;
SQL
```

Angka yang keluar harus **hanya untuk tenant demo**. Kalau ada tenant
lain (misal `acme-test`), angka di atas TIDAK boleh berubah setelah
tenant baru ditambah.

**Cross-check**: sebagai **service_role** (bypass RLS):

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres \
  -c "select tenant_id, count(*) from public.chart_of_accounts group by tenant_id;"
```

Harus tampil semua tenant (demo, acme-test, alpha, dst.) dengan
count masing-masing.

## Rate-limit test — self-signup abuse

**Per-IP cap**: 5 request per jam.

Test manual via browser (submit 6× berturut-turut ke `/register-org`)
— submission ke-6 muncul pesan
"Terlalu banyak percobaan dari IP ini". Buat automation, pakai
Playwright test di `e2e/tenant-self-signup.spec.ts` (§Playwright E2E
di bawah).

**Reset rate-limit counter**:

```bash
docker exec controldesk-redis redis-cli FLUSHDB
```

Kalau Redis tidak jalan, rate-limit fall back ke in-memory Map
(unsafe untuk multi-replica prod, OK untuk local). Restart app
container untuk reset in-memory counter:

```bash
docker compose restart app
```

## Playwright E2E — automated smoke

Suite otomatis untuk regresi CI: [`e2e/tenant-self-signup.spec.ts`](../../e2e/tenant-self-signup.spec.ts).
3 test, total ~20 detik di lokal.

**Coverage**:

1. **Happy path**: form → email dari mailpit → verify link → confirmation
   page dengan kredensial visible + URL scrubbed (token tidak muncul di
   history) + kedua email (verify + confirm) terkirim.
2. **Reject reserved slug**: submit `slug=www` → alert error muncul,
   `tenant_signup_requests` row tidak dibuat (verified via SQL).
3. **Reject malformed slug**: submit `slug=BAD SLUG!!` → tidak sampai
   ke confirmation screen (either server reject or HTML5 blocks submit).
4. **Cleanup automatic** — tenant + auth user + signup request dihapus
   di `afterAll` via docker exec psql (bypass triggers dengan
   `session_replication_role=replica`).

**Cara jalankan**:

```bash
# Prasyarat: dev server + mailpit + supabase local up
# (Prod container di :3001 belum di-rebuild? Test HARUS pakai :3000.)
pnpm dev &

# Point ke apex explicitly — playwright.config default demo.localhost:3000
PLAYWRIGHT_APEX_URL=http://localhost:3000 \
  pnpm exec playwright test e2e/tenant-self-signup.spec.ts
```

**Environment overrides** (opsional):

| Env | Default | Purpose |
| --- | --- | --- |
| `PLAYWRIGHT_APEX_URL` | `http://localhost:3000` | Base URL untuk `/register-org` (apex, bukan tenant subdomain) |
| `MAILPIT_URL` | `http://localhost:8025` | Mailpit REST API (`GET /api/v1/messages`) |
| `PW_SUPABASE_DB_CONTAINER` | `supabase_db_controldesk` | Docker container yang menjalankan Postgres — untuk cleanup |

Test **skip otomatis** kalau mailpit tidak reachable — biar tidak
false-fail di CI environment yang tidak menyediakan mailpit.

**Pattern untuk E2E test yang butuh email**: `findMessageTo()` di
suite ini bisa di-reuse untuk test lain yang butuh assert email
outbound (forgot password, verification, notification digest, dll.).
Pattern:

```ts
import { execSync } from "node:child_process";

async function findMessageTo(to: string, subject: RegExp) {
  const list = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`)
    .then(r => r.json());
  const hit = list.messages.find(
    m => m.To.some(t => t.Address === to) && subject.test(m.Subject),
  );
  return fetch(`${MAILPIT_URL}/api/v1/message/${hit.ID}`).then(r => r.json());
}
```

**Known migration dependency**: happy path test requires migration
**0079** applied (fix ambiguous `slug` reference in
`complete_tenant_signup()` RPC). Kalau test gagal di step verify
dengan `PROVISIONING_FAILED: column reference "slug" is ambiguous`,
apply migration 0079:

```bash
docker exec -i supabase_db_controldesk psql -U postgres -d postgres \
  < supabase/migrations/0079_fix_complete_tenant_signup_ambiguity.sql
```

## Gotcha lokal — cheat sheet

| Masalah | Penyebab | Fix |
| --- | --- | --- |
| `demo.localhost:3000` 404 di Safari <11 | Safari lama tidak resolve `*.localhost` | Update Safari atau tambah `127.0.0.1 demo.localhost` ke `/etc/hosts` |
| Server Action "Invalid request origin" | Origin subdomain tidak allow-listed | Sudah handled di `next.config.ts` (`*.localhost:3000` + `*.localhost:3001`). Tambah entry kalau pakai port lain. |
| Cookie tidak share antar subdomain | Wajar — Supabase cookie di-scope per host | Login ulang per subdomain. Untuk shared session, set cookie `Domain=.localhost` (belum di-config). |
| Email verify link 404 | Habis restart Redis → rate-limit reset tapi request row masih valid 24h | Cek: `select expires_at from public.tenant_signup_requests order by created_at desc limit 1;` |
| Trial banner tidak muncul | `plan != 'trial'` atau `trial_ends_at IS NULL` | UPDATE manual (§Skenario E) |
| Rate limit stuck | Redis persist counter | `docker exec controldesk-redis redis-cli FLUSHDB` |
| `pnpm dev` gagal `EADDRINUSE :3000` | Prod container juga bind 3000 secara internal | Container publish di 3001 — pastikan tidak konflik. Kalau host punya proses lain di 3000, kill: `lsof -ti:3000 \| xargs kill` |
| Suspend tenant tidak redirect | Proxy cache di browser | Hard reload `Cmd+Shift+R` atau incognito |
| Bulk feature toggle response `NO_TARGETS` | Filter mode='active' tapi semua tenant suspended | Ganti mode ke 'all' atau reactivate tenant |
| `provision_tenant` RPC failed `slug_taken` | Ada row `tenants` dengan slug sama | Cleanup dulu (§One-shot cleanup) |

## One-shot cleanup

Setelah selesai testing, reset ke state hanya demo:

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres <<'SQL'
begin;
set session_replication_role = replica;

-- Hapus semua tenant kecuali demo (seed)
delete from public.tenants where slug <> 'demo';

-- Purge signup requests
delete from public.tenant_signup_requests;

-- Hapus auth.users yang bukan platform admin
delete from auth.users
where id not in (select user_id from public.platform_admins where is_active);

set session_replication_role = default;
commit;
SQL

# Reset rate-limit + email
docker exec controldesk-redis redis-cli FLUSHDB
curl -s -X DELETE http://localhost:8025/api/v1/messages
```

**Sanity check** setelah cleanup — harusnya hanya 1 tenant (demo)
dan 1 platform admin:

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres -c \
  "select 'tenants' as tbl, count(*) from public.tenants union all select 'platform_admins', count(*) from public.platform_admins where is_active;"
```
