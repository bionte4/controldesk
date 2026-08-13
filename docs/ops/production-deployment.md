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
dsb.). Migrations harus di-apply lewat Supabase CLI:

```bash
# 5.1 Install Supabase CLI di VPS (sekali saja).
curl -fsSL https://supabase.com/install.sh | sh

# 5.2 Link ke Postgres self-hosted lokal + push migrations.
export SUPABASE_DB_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/postgres"
supabase db push --db-url "$SUPABASE_DB_URL"

# 5.3 Verify migration.
docker exec -it controldesk-db psql -U postgres -c '\dt public.*' | head -20
```

Semua migration di `supabase/migrations/` (termasuk `0090_seed_default_area_and_unit_pengaju.sql`) akan ter-apply berurutan. Migration `0020_jwt_role_claim_fix.sql` juga
akan setup `custom_access_token_hook` yang dibutuhkan GoTrue.

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
- [ ] Cek realtime notification bell (buka dua tab, submit approval, badge naik).

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

---

## Ops runbook — troubleshoot umum

### VPS reboot — semua service auto-restart?
`restart: unless-stopped` sudah diset di semua service. Kalau tidak jalan
setelah reboot, cek Docker daemon:
```bash
systemctl status docker
docker compose -f ~/controldesk/docker-compose.prod.yml --env-file ~/controldesk/.env.production up -d
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
1. Generate JWT_SECRET baru: `openssl rand -base64 48`.
2. Update `.env.production`.
3. Regenerate ANON_KEY + SERVICE_ROLE_KEY: `./deploy/scripts/generate-supabase-keys.sh`.
4. `NEXT_PUBLIC_SUPABASE_ANON_KEY` di-bake ke browser bundle → **wajib rebuild** `app` image.
5. Restart semua service: `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`.
6. **CATATAN**: Semua user existing akan force logout (JWT lama invalid).
   Coordinate dengan tenant admin dulu.

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
