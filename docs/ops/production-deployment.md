# Production deployment — single-VPS (5-10 trial tenants)

> **Target audience** — DevOps yang deploy ControlDesk pertama kali ke VPS
> production. Cover dari sewa VPS sampai tenant pertama berjalan di
> `https://<slug>.controldesk.app`.

## Rekomendasi VPS

| Tier | RAM   | vCPU | SSD    | Kandidat provider           | Estimasi harga | Cocok untuk       |
| ---- | ----- | ---- | ------ | --------------------------- | -------------- | ----------------- |
| A    | 8 GB  | 4    | 100 GB | Contabo VPS S SSD           | ~$8/bln        | 1-3 tenant dev    |
| **B**| 16 GB | 4    | 200 GB | Contabo VPS M / Hetzner CX32| ~$14-19/bln    | **5-10 tenant**   |
| C    | 32 GB | 8    | 400 GB | Contabo VPS L / Hetzner CX42| ~$28-35/bln    | 15-30 tenant      |

**Rekomendasi Tier B** untuk skenario 5-10 tenant trial. Setiap tenant asumsi
50-100 user aktif, ~500 request/menit peak, ~2 GB data. Semua sizing di file
`docker-compose.prod.yml` + `deploy/postgres/postgresql.conf` di-tune untuk
Tier B.

**OS pilihan**: Ubuntu 24.04 LTS atau Debian 12. Alpine di VPS jangan dulu —
Docker cukup ribet.

---

## Arsitektur setelah deploy

```
                        ┌─────────────────────────────────────────┐
                        │             Cloudflare DNS               │
                        │  A/AAAA record wildcard *.controldesk.app │
                        └────────────────────┬────────────────────┘
                                             │ HTTPS 443 / HTTP 80
                                             ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                     VPS (single node)                       │
   │  ┌────────────────────────────────────────────────────────┐ │
   │  │              Caddy (TLS termination)                   │ │
   │  │   *.controldesk.app  ─►  app:3000  (Next.js)          │ │
   │  │   api.controldesk.app ─►  kong:8000 (Supabase gw)     │ │
   │  └────────────────────────────────────────────────────────┘ │
   │           │                            │                    │
   │  ┌────────▼──────────┐    ┌────────────▼──────────────────┐│
   │  │  app (Next.js)    │    │  kong -> auth / rest /        ││
   │  │  redis            │    │          realtime / storage   ││
   │  │  ai-insights-cron │    │                                ││
   │  └────────┬──────────┘    └────────────┬──────────────────┘│
   │           └────────────┬───────────────┘                    │
   │                        ▼                                    │
   │            ┌──────────────────────────┐                     │
   │            │  Postgres 17 (tuned)     │                     │
   │            │  RLS, pgcrypto, pg_cron  │                     │
   │            └────────────┬─────────────┘                     │
   │                         │ pg_dump (cron 02:00 WIB)          │
   │                         ▼                                   │
   │            ┌──────────────────────────┐                     │
   │            │  backup sidecar          │                     │
   │            └────────────┬─────────────┘                     │
   └─────────────────────────┼─────────────────────────────────── ┘
                             │ HTTPS
                             ▼
                  ┌────────────────────────────┐
                  │  S3-compatible offsite      │
                  │  (Cloudflare R2 / B2 / SES) │
                  └────────────────────────────┘
```

---

## Langkah deploy — checklist urutan

### 0. Persiapan lokal
- [ ] `.env.production.example` sudah di-review dan tahu semua slot yang perlu diisi.
- [ ] Domain sudah didaftarkan (`controldesk.app`) dan zonanya dimanage di Cloudflare (butuh Cloudflare API token untuk wildcard TLS).
- [ ] Sudah punya akun SMTP transactional (Resend/Postmark/SES).
- [ ] Sudah punya bucket S3-compatible untuk backup (R2/B2/S3).

### 1. Sewa VPS + hardening awal
```bash
# 1.1 SSH ke VPS baru sebagai root, buat user non-root.
adduser controldesk
usermod -aG sudo controldesk
rsync --archive --chown=controldesk:controldesk ~/.ssh /home/controldesk

# 1.2 Disable root login + password auth.
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload sshd

# 1.3 Firewall: buka 22 (SSH), 80 (HTTP redirect ke HTTPS), 443 (HTTPS).
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp   # HTTP/3
ufw enable

# 1.4 Update sistem.
apt update && apt upgrade -y
apt install -y curl wget git ufw fail2ban unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades

# 1.5 Install Docker + Compose plugin.
curl -fsSL https://get.docker.com | sh
usermod -aG docker controldesk
```

### 2. Clone repo + generate secrets
```bash
# Sekarang login sebagai user 'controldesk' (bukan root).
ssh controldesk@your-vps-ip

git clone https://github.com/YOUR_ORG/controldesk.git
cd controldesk

# Generate .env.production.
cp .env.production.example .env.production
./deploy/scripts/generate-secrets.sh > /tmp/secrets.txt
cat /tmp/secrets.txt   # verify hasil
# Salin JWT_SECRET dulu ke .env.production, lalu:
set -a; . .env.production; set +a
./deploy/scripts/generate-supabase-keys.sh > /tmp/supabase-keys.txt
# Salin ANON_KEY + SERVICE_ROLE_KEY ke .env.production.
rm /tmp/secrets.txt /tmp/supabase-keys.txt
```

Isi manual: domain, SMTP, Cloudflare API token, AI provider (opsional), S3
backup credentials.

### 3. Setup DNS di Cloudflare
- [ ] `A` record `controldesk.app` → IP VPS.
- [ ] `A` record `*.controldesk.app` → IP VPS.
- [ ] `A` record `api.controldesk.app` → IP VPS.
- [ ] Proxy status: **DNS only (grey cloud)** — Caddy handle TLS langsung.
  Kalau pakai Cloudflare proxy (orange cloud), Caddy tetap bisa lewat DNS
  challenge tapi ada tambahan hop TLS.

Verifikasi:
```bash
dig +short A demo.controldesk.app
dig +short A api.controldesk.app
```

### 4. First boot stack
```bash
cd ~/controldesk

# 4.1 Pull image + build custom Caddy (dengan Cloudflare plugin) + app.
docker compose -f docker-compose.prod.yml --env-file .env.production build

# 4.2 Start stack.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# 4.3 Monitor boot.
docker compose -f docker-compose.prod.yml logs -f --tail=50

# 4.4 Verifikasi health tiap service.
docker compose -f docker-compose.prod.yml ps
```

Semua service harus `Status: Up (healthy)`. Kalau ada yang `Restarting`,
`docker compose logs <service>` untuk debug.

### 5. Apply migration + seed default
Postgres saat pertama boot masih kosong (belum ada schema `public.tenants`,
dsb.). Image `supabase/postgres` **TIDAK** otomatis apply migration di
subdir `/docker-entrypoint-initdb.d/migrations/*` (hanya top-level `.sql`),
jadi kita gunakan helper skrip `deploy/scripts/apply-migrations.sh` yang:

- Loop semua file `supabase/migrations/*.sql` (sorted lexicographic).
- Skip file yang sudah applied (tracked via `public._migration_history`).
- Verifikasi post-apply — memastikan `custom_access_token_hook`,
  `provision_tenant`, `seed_default_master_data`, dan
  `seed_default_eval_templates` semua exist.

```bash
# 5.1 Apply semua migration (idempotent — aman di-run ulang).
./deploy/scripts/apply-migrations.sh

# Contoh output sukses:
#   [apply-migrations] APPLY 0001_initial_schema.sql
#   [apply-migrations] APPLY 0002_...
#   ...
#   [apply-migrations]   applied: 90
#   [apply-migrations]   skipped: 0
#   NOTICE: Semua objek critical terverifikasi. Migration OK.

# 5.2 Verifikasi manual (opsional).
docker exec -it controldesk-db psql -U postgres -c '\dt public.*' | head -20

# 5.3 Verifikasi custom_access_token_hook — WAJIB ada sebelum first login.
docker exec -it controldesk-db psql -U postgres -c \
  "SELECT proname FROM pg_proc WHERE proname='custom_access_token_hook';"
# Harus return 1 row. Kalau kosong → migration 0020 belum apply, jangan
# lanjut ke step 6 (login akan gagal).
```

**Kenapa tidak pakai Supabase CLI?** Skrip ini bekerja tanpa Supabase CLI
di VPS. Kalau kamu mau pakai CLI (mis. sudah punya di dev machine), install:
```bash
wget -qO- https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \
  | tar -xz -C /tmp && sudo mv /tmp/supabase /usr/local/bin/
supabase db push --db-url "postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/postgres"
```
Tapi `apply-migrations.sh` lebih idempotent + include verification, jadi lebih
recommended untuk prod.

### 6. Provision super admin + tenant pertama
```bash
# 6.1 Buat user Super Admin lewat GoTrue Admin API.
curl -X POST "https://api.controldesk.app/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@controldesk.app",
    "password": "TemporaryPassword_ChangeMe_123!",
    "email_confirm": true
  }'

# 6.2 Assign role super_admin (idempotent).
docker exec -it controldesk-db psql -U postgres <<SQL
UPDATE auth.users
SET raw_app_meta_data = jsonb_build_object('role', 'super_admin')
WHERE email = 'superadmin@controldesk.app';
SQL

# 6.3 Login ke UI di https://controldesk.app/sign-in -> pindah ke
#     /super-admin/tenants/new -> provisioning tenant pertama (mis. "demo").
```

Setelah tenant di-provisioning, akan otomatis:
- Tenant slug di-generate → subdomain `demo.controldesk.app` aktif.
- Employee TENANT_ADMIN pertama di-create.
- Default master data (departments, positions, areas, unit_pengaju, budget categories, transport modes, RAB categories) di-seed via `seed_default_master_data()`.
- Default eval templates di-seed via `seed_default_eval_templates()`.
- Default AI config di-seed (kalau ada key AI di env).
- Default COA di-seed.

Login tenant admin ke `https://demo.controldesk.app/sign-in`.

### 7. Verifikasi end-to-end
- [ ] Login super admin di `https://controldesk.app/sign-in` → OK.
- [ ] Provision tenant `demo` → subdomain aktif dalam <60 detik.
- [ ] Login tenant admin di `https://demo.controldesk.app` → dashboard load.
- [ ] Test approval end-to-end: buat proyek → buat CA General kecil → approve chain.
- [ ] Cek email approver di inbox (verifikasi SMTP).
- [ ] Cek AI insight di `/insights` (kalau AI key diisi).
- [ ] Cek realtime notification bell (buka dua tab, submit approval, badge
      naik tanpa refresh — validasi WebSocket upgrade).
- [ ] **Tenant isolation smoke test** (rules §5 + §19):
  - Provision tenant kedua `alpha`.
  - Login sebagai user tenant `demo`, upload avatar profile.
  - Copy signed URL avatar tersebut.
  - Login incognito sebagai user tenant `alpha`, paste signed URL → harus
    kembali `403 Forbidden` (bukan gambar). RLS `storage.objects` enforce
    prefix `{tenant_id}/` per rules §19.
  - Dari SQL Editor tenant `alpha`, run `SELECT count(*) FROM public.employees;`
    → harus HANYA return employees tenant `alpha` (bukan demo).

### 8. Setup backup verifikasi
Sidecar backup jalan otomatis di 02:00 WIB tiap hari. Sekali seminggu, restore
test ke staging VPS untuk verifikasi backup valid:

```bash
# Ambil backup terbaru dari S3.
aws --endpoint-url $BACKUP_S3_ENDPOINT s3 ls "s3://${BACKUP_S3_BUCKET}/daily/" | tail

# Download + restore ke staging DB.
aws --endpoint-url $BACKUP_S3_ENDPOINT s3 cp "s3://${BACKUP_S3_BUCKET}/daily/<latest>/<file>.sql.gz" .
gunzip -c *.sql.gz | psql -h staging-db -U postgres
```

Rules §22: audit log retensi 7 tahun. Kolom `security_audit_logs` sudah
retensi long-term di DB — backup jadi copy tambahan offsite.

### 9. Enable SMTP (Resend) — password reset + magic link + notif email

Stack sudah wired lengkap (Supabase Auth via `GOTRUE_SMTP_*` + app mailer
via `src/lib/notify/mailer.ts`). Yang perlu dilakukan: verify domain di
Resend, generate API key, isi 5 env var, restart 2 service.

**Fase 9a — Resend account + verify domain (~15 menit di dashboard Resend)**

1. Buka [resend.com](https://resend.com) → Sign up (free tier 100 email/hari,
   3000 email/bulan — cukup untuk approval notif volume MVP).
2. Dashboard → **Domains** → **Add Domain** → masukkan `controldesk.site`
   (atau apapun `ROOT_DOMAIN` kamu di `.env.production`).
3. Resend akan tampilkan 3-4 DNS record (SPF, DKIM x2, DMARC opsional).
   Tambahkan semuanya sebagai **DNS-only** record di Cloudflare (jangan
   proxy, biar SPF/DKIM lookup langsung reach Resend):

   | Type | Name | Value | Proxy |
   |---|---|---|---|
   | TXT | `send` | `v=spf1 include:_spf.resend.com ~all` | DNS-only |
   | TXT | `resend._domainkey` | (long DKIM public key dari Resend) | DNS-only |
   | MX  | `send` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) | DNS-only |

   Optional tapi recommended:

   | Type | Name | Value | Proxy |
   |---|---|---|---|
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:admin@controldesk.site` | DNS-only |

4. Klik **Verify DNS records** di Resend dashboard — biasanya ready dalam
   1-2 menit setelah Cloudflare propagate. Kalau lambat, refresh
   Cloudflare DNS dashboard untuk pastikan record sudah tersimpan.
5. Setelah verified (icon centang hijau semua), **API Keys** → **Create
   API Key** → nama `controldesk-prod`, permission `Sending access` +
   scope ke domain `controldesk.site`. Copy key (`re_xxx...`) — ini yang
   akan dipakai sebagai `SMTP_PASS`. Key ini hanya ditampilkan sekali.

**Fase 9b — Isi env + restart (~2 menit di server)**

```bash
cd ~/controldesk

# Backup .env sebelum edit (biar bisa rollback).
cp .env.production .env.production.bak.$(date +%Y%m%d-%H%M%S)

# Edit SMTP block — biasanya di sekitar baris 100-110.
nano .env.production
```

Yang perlu di-set (ganti nilai placeholder):

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # ← API key dari Fase 9a #5
SMTP_FROM=noreply@controldesk.site
SMTP_ADMIN_EMAIL=admin@controldesk.site
SMTP_SENDER_NAME=ControlDesk
```

Restart service yang baca env-vars ini:

```bash
# Supabase Auth (password reset, magic link, verify) baca GOTRUE_SMTP_*.
dcp restart auth

# App container (approval notif, digest cron, workspace signup) baca
# SMTP_* env-global.
dcp restart app

# Cek log auth boot untuk verify SMTP config terbaca.
dcp logs --tail 30 auth | grep -i smtp
# Expected: "SMTP host: smtp.resend.com" atau tidak ada error terkait SMTP.
```

**Fase 9c — Smoke test (~3 menit)**

1. **Password reset test** — buka `https://<tenant>.controldesk.site/login`
   → klik "Lupa password?" → masukkan email yang terdaftar → cek inbox
   (juga folder spam pertama kali). Email harus datang dalam 30 detik.
   Kalau tidak masuk:

   ```bash
   dcp logs --tail 100 auth 2>&1 | grep -iE "smtp|mail|550|554"
   ```

2. **Approver notif test** — buat pengajuan expense/CA kecil → tunggu
   ke approver → cek email approver. Ini akan lewat `src/lib/notify/
   mailer.ts` env-path (bukan tenant path, karena tenant_smtp_configs
   masih kosong).

3. **Cek email_outbox** — semua send yang berhasil harus muncul di tabel:

   ```bash
   docker exec -i controldesk-db psql -U postgres -d postgres -c "
     select id, subject, from_address, status, sent_at
     from public.email_outbox
     order by created_at desc limit 5;
   "
   ```

   Kalau `status = SKIPPED` → mailer tidak dapat config (biasanya
   `SMTP_HOST` kosong atau restart belum applied). Kalau `FAILED` →
   kolom `last_error` isi detail (auth failed, connection refused, dst).

**Fase 9d — Optional: per-tenant SMTP (nanti kalau dibutuhkan)**

Kalau ada tenant premium yang ingin pakai relay sendiri (mis. Postmark
dengan sender warmup lebih tinggi), TENANT_ADMIN bisa buka
`/settings/integrations/smtp` di dashboard mereka, isi row baru di
`tenant_smtp_configs`. Row aktif override env-global — lihat resolution
order di `src/lib/notify/mailer.ts` docblock.

---

## Ops runbook — troubleshoot umum

> **Gotcha #1 — Docker Compose butuh `--env-file .env.production` di SETIAP invokasi.**
> Semua contoh command di bawah menyertakannya. Kalau lupa, Compose bakal error
> "required variable X is missing a value" walaupun `.env.production` ada di
> folder yang sama. Ini karena Compose default cuma baca file bernama persis
> `.env` (bukan `.env.production`). Alias yang bisa kamu tambah ke shell
> profile supaya tidak lupa:
>
> ```bash
> echo "alias dcp='docker compose -f ~/controldesk/docker-compose.prod.yml --env-file ~/controldesk/.env.production'" >> ~/.bashrc
> source ~/.bashrc
> # Sekarang tinggal: `dcp build app`, `dcp up -d`, `dcp logs app`, dst.
> ```

### Deploy code update (pull latest branch)

Skenario paling sering — ada commit baru di remote yang mau kamu bawa ke
production tanpa restart penuh Supabase stack.

> **Gotcha #2 — `docker compose up -d app` TIDAK recreate container kalau
> image tag tetap sama.** Compose mem-hash konfigurasi (image name, env,
> volume, network) dan skip recreation kalau hash-nya sama. Rebuild image
> dengan tag identik tidak mengubah hash → container LAMA tetap jalan
> walaupun ada image baru. Selalu pakai `--force-recreate --no-deps` untuk
> update code. Bandingkan `docker inspect <container> --format '{{.Image}}'`
> vs `docker inspect <image>:<tag> --format '{{.Id}}'` untuk konfirmasi
> drift.

```bash
cd ~/controldesk

git fetch origin feat/initial-controldesk-platform
git log --oneline HEAD..origin/feat/initial-controldesk-platform  # preview

git pull --ff-only origin feat/initial-controldesk-platform
# Kalau tidak fast-forward-able, biasanya ada local commit di server —
# lihat runbook "Server branch diverged" di bawah.

# Rebuild HANYA image app (source code Next.js). Postgres/Kong/Auth/dst
# tidak perlu di-rebuild karena mereka pakai upstream image.
docker compose -f docker-compose.prod.yml --env-file .env.production build app

# --force-recreate WAJIB — tanpa flag ini Compose skip container lama
# yang masih pakai image basi (lihat Gotcha #2 di atas).
# --no-deps supaya HANYA app di-recreate, DB/Kong/Auth/Realtime/Storage
# tetap running (zero-downtime dari sisi user).
docker compose -f docker-compose.prod.yml --env-file .env.production \
  up -d --no-deps --force-recreate app

# Konfirmasi container SUDAH pakai image baru (uptime harus hitungan detik).
docker ps --filter name=controldesk-app --format "table {{.Names}}\t{{.Status}}"
docker inspect controldesk-app --format 'Container using: {{.Image}}'
docker inspect controldesk/app:prod --format 'Latest image:   {{.Id}}'
# Kedua sha256 di atas HARUS sama sekarang.

# Health check — tunggu ~30 detik supaya health-starting grace period lewat.
sleep 30
curl -sf http://localhost:3000/api/health && echo " ← OK" || echo "FAIL"
docker logs controldesk-app --tail 40 2>&1 | grep -E "Ready|Error"
```

**Kalau ada migration baru** (`supabase/migrations/00XX_*.sql` yang belum
applied), tambahkan step sebelum `up -d --force-recreate app`:

```bash
./deploy/scripts/apply-migrations.sh
```

Skrip ini idempotent — sudah punya `_migration_history` guard, tidak
double-apply. Kalau ada migrasi yang touch RLS policies dan gagal dengan
`must be owner of relation ...` → lihat "Migration owner permission error"
di bawah.

### Migration owner permission error (`must be owner of relation ...`)

Skenario: `./deploy/scripts/apply-migrations.sh` gagal dengan error seperti:

```
ERROR:  must be owner of relation knowledge_articles
ERROR:  must be owner of function provision_tenant
ROLLBACK
```

**Root cause** — script default connect sebagai user `postgres`, tapi
sebagian object (tabel, function) di-own oleh `supabase_admin` (bawaan
image `supabase/postgres`). Postgres di image ini **bukan superuser**, jadi
tidak bisa `ALTER`/`DROP` object milik `supabase_admin` — termasuk
`DROP POLICY`, `CREATE OR REPLACE FUNCTION`, dsb.

Migrasi yang paling sering kena issue ini:
- Migrasi RLS policy replace (`drop policy … create policy …`)
- Migrasi function replace (`create or replace function …`) untuk function
  yang originally dibuat oleh `supabase_admin`

**Fix — apply migrasi tsb sebagai `supabase_admin`, lalu record ke history:**

```bash
cd ~/controldesk

# Contoh: 3 migrasi Fase 2c gagal karena touch policy knowledge_articles
for f in \
  supabase/migrations/0097_knowledge_articles_admin_gate_unify.sql \
  supabase/migrations/0098_knowledge_articles_visibility_constraints.sql \
  supabase/migrations/0099_knowledge_articles_visibility_rls.sql
do
  fname=$(basename "$f")
  hash=$(sha256sum "$f" | cut -d' ' -f1)
  echo "=== APPLY $fname (sha256: ${hash:0:12}...) ==="

  # supabase_admin sebagai owner → bisa DROP/CREATE POLICY dan REPLACE FUNCTION.
  # WAJIB -d postgres, karena default psql -U supabase_admin coba connect ke
  # database yang namanya "supabase_admin" (tidak ada) → FATAL.
  docker exec -i controldesk-db psql -U supabase_admin -d postgres \
    -v ON_ERROR_STOP=1 -X -q < "$f" || { echo "FAILED $fname"; break; }

  # Record ke _migration_history supaya apply-migrations.sh skip next run.
  docker exec -i controldesk-db psql -U postgres -d postgres -c \
    "INSERT INTO public._migration_history (filename, sha256)
     VALUES ('$fname', '$hash')
     ON CONFLICT (filename) DO UPDATE SET sha256 = EXCLUDED.sha256;"
done

# Re-run apply-migrations.sh — sekarang harus skip semua 3 file di atas.
./deploy/scripts/apply-migrations.sh 2>&1 | tail -10
```

**Kenapa transaction rollback aman** — script pakai `BEGIN … COMMIT` per
migrasi + `ON_ERROR_STOP=1`, jadi migrasi yang gagal otomatis di-ROLLBACK.
DB state tetap konsisten, tidak ada partial apply.

**Long-term fix** — kalau ini sering terjadi, patch `apply-migrations.sh`
untuk detect ownership error dan auto-fallback ke `supabase_admin`. Sudah
ada di roadmap.

### Column-level REVOKE — post-mortem + author checklist

**Post-mortem (Aug 2026, itps + demo redirect loop):** migration
`0100_employees_salary_column_privilege.sql` REVOKE'd table-level SELECT
on `public.employees` from `authenticated` (dynamic re-GRANT of every
column except `monthly_salary` + `hourly_rate`). That silently broke
`getCurrentEmployee()` in `src/lib/auth/session.ts` which used
`.select('*')`. PostgREST rewrites `select('*')` to `SELECT *` — that
needs the **table-level** SELECT, not column-level. Query returned
`error: 42501 permission denied for relation employees`, helper
returned `null`, `requireCurrentEmployee()` fired `redirect('/login')`,
proxy still saw a valid session cookie → bounced `/login` → `/dashboard`,
infinite loop (37+ nav attempts triggered Chrome throttle). Fixed in
commit [`48e981b`](https://github.com/bontiharyanto/controldesk/commit/48e981b)
by enumerating 30 explicit columns and narrowing `CurrentEmployee` type
to `Omit<Tables<'employees'>, 'monthly_salary' | 'hourly_rate' | 'user_id'>`.

Only caught in production because unit tests mock Supabase — real
column-privilege errors don't surface. Adding an integration test for
`getCurrentEmployee()` against a real Postgres role is in the follow-up
backlog.

**Author checklist — mandatory before landing any column-level REVOKE
migration:**

1. **Grep for `.select("*")` on the affected table:**

   ```bash
   rg "from\(([\"'\`])$TABLE\\1\\)[\\s\\S]{0,200}\\.select\\(([\"'\`])\\*" \
     --multiline --multiline-dotall src/
   ```

   Every hit MUST be refactored to an explicit column list that excludes
   the revoked column(s). Prefer just the columns the caller actually
   uses (audit trail: name the fields in a comment above the `.select()`
   so future edits know why the enumeration exists).

2. **Grep for downstream `.monthly_salary` / `.contract_value` (or
   whatever field was revoked) reads via user-JWT client:**

   ```bash
   rg "\\.$COLUMN\\b" src/ --type ts | grep -v service-role
   ```

   Anything hit here that isn't already service-role-gated MUST either
   (a) be moved to the service-role client after PDP authorization, OR
   (b) be conditionally omitted based on a role predicate (like
   `CONTRACT_VIEWER_ROLES` for `contract_value`).

3. **Narrow the type of any helper that returns the table row:**

   Add the revoked columns to an `Omit<>` on the exported type, so
   downstream consumers surface a TypeScript error when they reference
   the removed field — the compiler now catches what the runtime would.

   Example (`session.ts` post-fix):

   ```typescript
   export type CurrentEmployee = Omit<
     Tables<"employees">,
     "user_id" | "monthly_salary" | "hourly_rate"
   > & { user_id: string; tenant_slug: string };
   ```

4. **Smoke test in an incognito browser BEFORE calling done:**

   Log in as a plain EMPLOYEE role (not admin) after applying the
   migration. Navigate to `/dashboard`, then to one page that reads the
   affected table (`/hr/employees` for employees, `/projects/<id>` for
   projects, etc). Empty screen or redirect loop = there's still a
   `.select('*')` or column reference somewhere.

5. **Update this runbook** with the migration number + which columns
   were revoked + which read sites you migrated to service-role.

### Server branch diverged (git pull --ff-only gagal)

Skenario: kamu edit file di server (misal quick hotfix, atau merge commit
buatan `git pull` biasa), lalu remote juga punya commit baru → history
divergent. Pilihan aman:

```bash
# 1) Preview siapa punya commit apa
git log --oneline HEAD ^origin/feat/initial-controldesk-platform  # commit local yang belum di-push
git log --oneline origin/feat/initial-controldesk-platform ^HEAD  # commit remote yang belum di-pull

# 2A) Kalau commit lokal masih ada value → merge (buat merge commit)
git pull --no-rebase origin feat/initial-controldesk-platform
git push origin feat/initial-controldesk-platform

# 2B) Kalau commit lokal boleh dibuang → reset hard
git fetch origin feat/initial-controldesk-platform
git reset --hard origin/feat/initial-controldesk-platform
# HATI-HATI: menghapus local commit yang tidak ada di remote.
```

### VPS reboot — semua service auto-restart?
`restart: unless-stopped` sudah diset di semua service. Kalau tidak jalan
setelah reboot, cek Docker daemon:
```bash
systemctl status docker
docker compose -f ~/controldesk/docker-compose.prod.yml \
  --env-file ~/controldesk/.env.production up -d
```

### RAM pressure — Postgres OOM
Cek utilization:
```bash
docker stats --no-stream
free -h
```
Kalau Postgres > 5 GB usage sering, turunkan `shared_buffers` di
`deploy/postgres/postgresql.conf` dari 4GB → 3GB, restart container.

### Kong return 502 Bad Gateway
Salah satu upstream (auth/rest/realtime/storage) down. Cek:
```bash
docker compose -f docker-compose.prod.yml logs auth rest realtime storage
```

### Caddy tidak dapat cert wildcard
Cek Cloudflare API token scope (harus `Zone:DNS:Edit` untuk zone tsb.):
```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -i acme
```

### AI Insights tidak jalan
1. Cek env `GOOGLE_GENERATIVE_AI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` terisi.
2. Cek cron sidecar log: `docker compose logs ai-insights-cron`.
3. Cek route manual: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ai-insights-sweep`.

### Rotate JWT_SECRET (setelah 90 hari, rules §22)

Otomatis via skrip `deploy/scripts/rotate-jwt.sh`:

```bash
cd ~/controldesk
./deploy/scripts/rotate-jwt.sh
# → backup .env.production ke .env.production.bak-<timestamp>
# → generate JWT_SECRET + ANON_KEY + SERVICE_ROLE_KEY baru
# → tulis kembali ke .env.production
# → print instruksi rebuild + restart step-by-step
```

Lalu ikut instruksi yang di-print skrip (rebuild `app` + recreate
`app auth rest realtime storage kong`). Downtime ~2-5 menit.

**Konsekuensi rotate:**
- Semua user existing force logout — JWT lama tidak valid lagi.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` di-bake ke browser bundle di build time
  → wajib rebuild image `app` (skrip sudah suggest command).
- Kong config di-render ulang via `envsubst` di container entrypoint,
  jadi `--force-recreate kong` cukup (bukan restart).
- Storage + Realtime + PostgREST validate token pakai JWT_SECRET baru
  otomatis (env variable, tidak perlu rebuild).

**Rollback kalau ada issue:**
```bash
cp .env.production.bak-<timestamp> .env.production
docker compose -f docker-compose.prod.yml --env-file .env.production \
  up -d --force-recreate app auth rest realtime storage kong
```

### Idle timeout policy (session inactivity)

Client-side idle timeout otomatis logout user setelah N menit tanpa
aktivitas (mouse/keyboard/click/scroll). Warning modal muncul sebelum
logout supaya user bisa "Lanjutkan sesi". Berlaku untuk **app** (tenant
users) dan **portal** (external clients).

**Env vars di `.env.production`:**

```bash
NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES=30   # Default 30. Range [1, 1440].
NEXT_PUBLIC_IDLE_WARNING_MINUTES=2    # Warning muncul di menit (TIMEOUT - WARNING). Range [1, TIMEOUT - 1].
```

**Kapan tune:**
- Prod normal: `30 / 2` (default).
- Tenant PII-heavy (mis. HR-only workspace): turunkan ke `15 / 2`.
- Dev / demo: bisa naikkan ke `480 / 5` (8 jam) supaya tidak ganggu debugging.

**Deploy setelah ubah:** kedua var ini `NEXT_PUBLIC_*` — di-inline saat
build. WAJIB rebuild image (`docker compose ... build app`) dan
`--force-recreate app`. Restart tanpa rebuild TIDAK berpengaruh.

**Enforcement:** UX defense-in-depth di atas Supabase JWT expiry
(`GOTRUE_JWT_EXP=3600` = 1 jam absolut). Idle timeout mengatasi kasus
"laptop ditinggal unlocked" tapi tidak melindungi dari refresh-token
theft — untuk itu, rotate `JWT_SECRET` per §22 rules (90 hari).

**Cross-tab sync:** provider pakai `BroadcastChannel`. Kalau user aktif
di tab A, tab B (idle) tetap ter-reset. Semua tab logout bersamaan saat
timer akhirnya jatuh.

### Finance data RLS tightening (migrations 0100 + 0101)

Migrations **0100** and **0101** close the tenant-wide read leak on salary
and commercial finance data documented in the Fase A/B security audit.
Read this section before applying — they touch RLS + column privileges,
which historically hit the "must be owner of relation" gotcha on this
deployment (see the Migration owner permission error section above).

**What changes:**

- **0100** — column-level SELECT REVOKE on `employees.monthly_salary` +
  `hourly_rate` from the `authenticated` role. Legitimate consumers
  (payroll cron, UPK auto-gen after OM approval) already switched to the
  service-role client in the same PR; user-JWT queries via browser
  devtools now get `permission denied for column monthly_salary`.
- **0101** — SELECT policies on `bpo_contracts`, `budgets`,
  `budget_details` rewritten to require `is_finance_leader()` (contracts)
  or `is_finance_management()` / `is_project_member()` (budgets +
  details). View `v_project_budget_lines` gains `security_invoker=true`
  so it actually respects the underlying RLS.

**Deploy steps:**

```bash
cd ~/controldesk
git pull origin feat/initial-controldesk-platform
./deploy/scripts/apply-migrations.sh
```

**If you hit `must be owner of relation employees` or `must be owner of
relation bpo_contracts`:** the tables were originally created by
`supabase_admin`, not `postgres`. Fix per the "Migration owner
permission error" section above — apply as `supabase_admin`:

```bash
docker exec -it controldesk-db psql -U supabase_admin -d postgres \
  -f /docker-entrypoint-initdb.d/migrations/0100_employees_salary_column_privilege.sql

docker exec -it controldesk-db psql -U supabase_admin -d postgres \
  -f /docker-entrypoint-initdb.d/migrations/0101_finance_data_rls_tighten.sql
```

Then manually mark them applied in `_migration_history`:

```bash
docker exec -i controldesk-db psql -U postgres -d postgres <<'SQL'
INSERT INTO _migration_history (filename, sha256) VALUES
  ('0100_employees_salary_column_privilege.sql', ''),
  ('0101_finance_data_rls_tighten.sql', '')
ON CONFLICT DO NOTHING;
SQL
```

**Smoke test after apply:**

```bash
# 1. Verify column privilege stripped for authenticated
docker exec -i controldesk-db psql -U postgres -d postgres <<'SQL'
SELECT has_column_privilege('authenticated', 'public.employees', 'monthly_salary', 'SELECT')
  AS auth_can_read_salary;
-- Expected: f
SQL

# 2. Verify helpers exist
docker exec -i controldesk-db psql -U postgres -d postgres <<'SQL'
SELECT proname FROM pg_proc
WHERE proname IN ('is_finance_leader', 'is_finance_management')
ORDER BY proname;
-- Expected: 2 rows
SQL

# 3. Verify tightened policies
docker exec -i controldesk-db psql -U postgres -d postgres <<'SQL'
SELECT tablename, policyname,
  pg_get_expr(polqual, polrelid) LIKE '%is_finance%' AS is_tightened
FROM pg_policies pol
JOIN pg_policy pp ON pp.polname = pol.policyname
WHERE tablename IN ('bpo_contracts', 'budgets', 'budget_details')
  AND policyname LIKE '%_tenant_read';
-- Expected: is_tightened=t on all three rows
SQL
```

**Then test in browser (as EMPLOYEE role):**
- Open devtools console after logging in to `/dashboard`
- Run `await (window.__supabase || createBrowserClient(...)).from('employees').select('monthly_salary')`
- Expected: `{ data: null, error: { code: '42501', message: 'permission denied for column monthly_salary' } }`

**Deferred follow-up delivered in migrations 0102 + 0103** — see next
section for the details + deploy steps.

### Contract-value + project-scoped RLS (migrations 0102 + 0103)

Migrations **0102** and **0103** finish the Fase A/B security audit
bundle. Read this AFTER applying 0100 + 0101 above — they layer on top.

**What changes:**

- **0102** — column-level SELECT REVOKE on `projects.contract_value`
  from the `authenticated` role (same DO-block pattern as 0100). Legit
  read sites already switched to service-role in the same PR:
  - `src/app/(app)/projects/[id]/page.tsx` — separate service-role
    read only when `authorize({ action: "update", resource: "project" })`
    is ALLOW (OM+/TENANT_ADMIN); the value flows to `EditProjectSheet`
    and nowhere else on the page.
  - `src/lib/reports/queries/project-portfolio.ts` — full query moved
    to service-role because `runReport()` already gates by
    `meta.allowedRoles.includes(dbRole)` (Finance + PM).
  - `src/lib/ai/tools/index.ts` (`project_info` tool) — checks
    `roleInGate(ctx.dbRole, CONTRACT_VIEWER_ROLES)`; non-leader
    callers get `contract_value_label: null` so the LLM can't leak
    the figure.

- **0103** — SELECT RLS on `project_expenses` and `cash_advances`
  rewritten from tenant-open to a three-way scope (`is_org_scope()`,
  `is_approver_role() + current_visible_project_ids()`, or self via
  `submitter_employee_id` / `requester_employee_id`). Ports the
  app-layer `resolveProjectScope()` + `buildApproverOrSelfClause()`
  semantics. New helpers: `public.is_org_scope()`,
  `public.is_portfolio_scope()`, `public.is_approver_role()`,
  `public.current_visible_project_ids()` (recursive CTE, 8-hop cap).
  UPDATE policies stay tenant-open for now — approvers legitimately
  UPDATE rows on other users' submissions to advance approval state;
  tightening those is a separate follow-up.

**Deploy steps:**

```bash
cd ~/controldesk
git pull origin feat/initial-controldesk-platform
./deploy/scripts/apply-migrations.sh
```

**If you hit `must be owner of relation projects` / `must be owner of
relation project_expenses` / `must be owner of relation cash_advances`:**
same fix as 0100 / 0101 — apply as `supabase_admin`:

```bash
docker exec -it controldesk-db psql -U supabase_admin -d postgres \
  -f /docker-entrypoint-initdb.d/migrations/0102_projects_contract_value_column_privilege.sql

docker exec -it controldesk-db psql -U supabase_admin -d postgres \
  -f /docker-entrypoint-initdb.d/migrations/0103_expenses_ca_rls_project_scope.sql
```

Then mark them applied:

```bash
docker exec -i controldesk-db psql -U postgres -d postgres <<'SQL'
INSERT INTO _migration_history (filename, sha256) VALUES
  ('0102_projects_contract_value_column_privilege.sql', ''),
  ('0103_expenses_ca_rls_project_scope.sql', '')
ON CONFLICT DO NOTHING;
SQL
```

**Smoke test after apply:**

```bash
# 1. Verify projects.contract_value stripped for authenticated
docker exec -i controldesk-db psql -U postgres -d postgres <<'SQL'
SELECT has_column_privilege(
  'authenticated', 'public.projects', 'contract_value', 'SELECT'
) AS auth_can_read_contract;
-- Expected: f
SQL

# 2. Verify new scope helpers exist
docker exec -i controldesk-db psql -U postgres -d postgres <<'SQL'
SELECT proname FROM pg_proc
WHERE proname IN (
  'is_org_scope', 'is_portfolio_scope',
  'is_approver_role', 'current_visible_project_ids'
)
ORDER BY proname;
-- Expected: 4 rows
SQL

# 3. Verify new SELECT policies wired
docker exec -i controldesk-db psql -U postgres -d postgres <<'SQL'
SELECT tablename, policyname,
  pg_get_expr(polqual, polrelid) LIKE '%current_visible_project_ids%'
    AS is_scoped
FROM pg_policies pol
JOIN pg_policy pp ON pp.polname = pol.policyname
WHERE tablename IN ('project_expenses', 'cash_advances')
  AND policyname IN ('expenses_scoped_read', 'ca_scoped_read');
-- Expected: is_scoped=t on both rows
SQL
```

**Then test in browser (as EMPLOYEE role):**

- Open devtools after logging in as an EMPLOYEE.
- Run `await window.__supabase.from('projects').select('id, contract_value').limit(1)`
- Expected: `{ data: null, error: { code: '42501', message: 'permission denied for column contract_value' } }`
- Run `await window.__supabase.from('project_expenses').select('id').limit(20)`
- Expected: only rows this employee submitted (previously returned all tenant rows).

### Budget visibility matrix — who sees what (rules §3 / §9)

Budget data has **two orthogonal capability gates** so tenants can dial
access without forking the codebase. Both live in
`src/lib/rbac/capabilities.ts` and can be overridden per-tenant via the
admin matrix at `/settings/capabilities`.

| Capability            | What it controls                                                                                                | Default roles                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `view_budget`         | Access the **budget module** — list rows, detail page, project card, dashboard portfolio tiles, `/projects` list Budget column. | `PROJECT_MANAGER`, `OPERATIONS_MANAGER`, `HEAD_MANAGER`, `GENERAL_MANAGER`, `LEAD_FINANCE`, `TENANT_ADMIN` |
| `view_budget_amount`  | Render the **rupiah figures** (Rp X.XXX.XXX) verbatim. When denied, every amount cell renders as `Rp ******`. Nested: `!view_budget → !view_budget_amount`. | `HEAD_MANAGER`, `GENERAL_MANAGER`, `LEAD_FINANCE`, `TENANT_ADMIN`   |

**Effective visibility by canonical role (default settings):**

| Role                | Section visible? | Amounts visible?          |
| ------------------- | ---------------- | ------------------------- |
| `EMPLOYEE`          | no               | n/a                       |
| `SUPERVISOR`        | no               | n/a                       |
| `PROJECT_MANAGER`   | yes              | **no — masked `Rp ******`** |
| `OPERATIONS_MANAGER`| yes              | **no — masked `Rp ******`** |
| `HEAD_MANAGER`      | yes              | yes                       |
| `GENERAL_MANAGER`   | yes              | yes                       |
| `LEAD_FINANCE`      | yes              | yes                       |
| `TENANT_ADMIN`      | yes              | yes                       |

**Where the mask renders:**

- `/finance/budgets` — `Total Planned` column.
- `/finance/budgets/[id]` — four summary tiles + line-item Planned /
  Realized / Outstanding / Remaining columns. Progress bar visible but
  numeric utilisation percentage dropped under mask.
- `/projects/[id]` — budget summary card (`Spent` / `Of`), recent
  expense amounts.
- `/projects` — Budget column.
- `/dashboard` — `Approved Budget` KPI, portfolio totals strip
  (planned / realised / outstanding), per-tile planned / realised /
  outstanding trio.

**How to override per-tenant** — e.g. tenant wants OM to see nominal
amounts too:

1. Log in as `TENANT_ADMIN` → `/settings/capabilities`.
2. Locate `view_budget_amount` row (high-sensitivity, will confirm
   before applying).
3. Check the `OPERATIONS_MANAGER` cell → toggle grants.
4. Cell state changes from `default-deny` to `override-allow`
   (green). Audit log records who + when in `security_audit_logs`.
5. All OM sessions refresh capability set on next request (React
   cache invalidates per-request).

**Reverse case** — tenant wants PM to still see amounts for their own
projects: currently NOT supported at Phase 1. Would require join-based
data-layer masking (see roadmap below). Workaround: grant PM
`view_budget_amount` via override → they see all budget amounts
tenant-wide. Only recommended for small tenants where PM ~= OM in
practice.

**Phase 1 scope (delivered):**

- UI-only mask. Data mentah **masih** flow ke client bundle via RSC
  payload — a savvy PM inspecting DevTools Network tab can still see
  the raw amounts. `Rp ******` protects casual observation (e.g.
  screen-share, over-shoulder) but not adversarial inspection.

**Phase 2 (data-layer strip) — TODO backlog:**

Server-side sanitize `budget.total_planned_amount` /
`budget_details.planned_amount` etc. → `null` when caller lacks
`view_budget_amount`, before returning from Server Component /
`getPortfolioSnapshot()`. Would close the RSC payload leak. Estimated
~3-4 hours. Track in project TODO.

**Phase 3 (RLS column mask) — TODO backlog:**

DB-level REVOKE SELECT on `budgets.total_planned_amount` +
`budget_details.planned_amount` + `..realized_amount` +
`..outstanding_amount` from `authenticated`, mirroring the salary
Phase A pattern (migration 0100). Would close REST snoop / devtools
Supabase-client bypass. New RLS helper `is_finance_management_amount()`
gates the re-GRANT. Estimated ~3 hours plus one migration + refactor
of `select('*')` sites to explicit columns. Track in project TODO.

### Known issues (non-blocking)

Backlog issues yang sudah muncul di prod tapi tidak mem-block operasi
harian. Track di TODO list dan address saat prioritas naik.

**PWA service worker crash — `Cannot find package 'esbuild'`**

Gejala di `docker logs controldesk-app`:
```
Error: Cannot find package 'esbuild' imported from
  /app/.next/server/chunks/[root-of-the-server]__xxxxxx._.js
```
Dan di browser console:
```
Failed to register a ServiceWorker for scope ('https://<domain>/')
with script ('https://<domain>/serwist/sw.js'):
A bad HTTP response code (500) was received when fetching the script.
```

**Root cause** — `src/app/serwist/[[...path]]/route.ts` pakai
`@serwist/turbopack` yang butuh `esbuild` di runtime untuk compile
`src/sw.ts`. `esbuild` di-declare sebagai **devDependency** di
`package.json`, jadi tidak masuk standalone bundle → runtime crash saat
`/serwist/sw.js` di-request.

**Impact** — HANYA PWA offline capabilities (add-to-home-screen, offline
fallback). Main app + login + semua module regular functionality tetap
jalan normal karena SW registration failure ditangkap client-side dan
tidak block navigation.

**Fix options** (belum di-apply):
- Move `esbuild` dari `devDependencies` → `dependencies` di
  `package.json` (~10 MB penambahan bundle, quick fix).
- Pre-compile `src/sw.ts` ke static asset di build stage, skip Route
  Handler entirely (lebih clean, butuh refactor).
- Set `useNativeEsbuild: false` di `createSerwistRoute()` supaya pakai
  WASM esbuild yang self-contained.

**Workaround saat ini** — tidak perlu. Error di log bisa filter dengan
`docker logs controldesk-app 2>&1 | grep -v -E "esbuild|serwist"` untuk
troubleshoot lain.

**Network compose warning — `network X exists but was not created by compose`**

Gejala saat `docker compose up`:
```
WARN[0000] a network with name controldesk-prod exists but was not
created by compose. Set `external: true` to use an existing network
```

**Impact** — cosmetic. Container tetap join network dengan benar.

**Fix** — tambahkan `external: true` di block network `controldesk-prod`
di `docker-compose.prod.yml`. Belum urgent.

### Scale beyond 10 tenants
Signal untuk pindah ke Tier C (32 GB / 8 vCPU) atau split ke multi-node:
- Postgres CPU > 60% sustained selama 15 menit.
- Response time p95 > 500ms.
- RAM total usage > 12 GB.

Untuk scale ke > 30 tenant, pertimbangkan:
- Migrate Postgres ke managed service (Supabase Cloud / Neon / RDS).
- Deploy app + Redis + Caddy di 2-3 node terpisah (load balancer di depannya).
- Move Storage ke S3 native (`STORAGE_BACKEND=s3` di Storage API env).

---

## Cost estimate — Tier B baseline

| Item                            | Bulanan (IDR) | Catatan                                  |
| ------------------------------- | ------------- | ---------------------------------------- |
| VPS 16 GB / 4 vCPU / 200 GB     | ~230.000      | Contabo VPS M SSD                        |
| Domain + Cloudflare DNS         | ~15.000       | .app TLD ($12/tahun ≈ Rp15rb/bln)       |
| SMTP (Resend Pro)               | ~300.000      | 50k email/bulan                          |
| Backup S3 (Cloudflare R2)       | ~30.000       | 20 GB backup + egress $free              |
| AI provider (opsional)          | ~150.000      | Gemini 2.5 Flash pay-as-you-go           |
| **Total**                       | **~725.000**  | ~$46/bln — support 5-10 tenant           |

Skala per tenant: ~Rp70-140rb/bln biaya operasional (belum termasuk margin).

---

## Referensi
- Rules §2 — Docker containerization standar.
- Rules §22 — Retention, migrations, deployment environments, secret rotation.
- `docker-compose.prod.yml` — deklarasi stack.
- `deploy/postgres/postgresql.conf` — tuning DB.
- `deploy/Caddyfile` — reverse proxy + TLS.
- `deploy/kong/kong.yml` — API gateway route.
- `docs/product/end-to-end-walkthrough.md` — panduan tenant onboarding.
