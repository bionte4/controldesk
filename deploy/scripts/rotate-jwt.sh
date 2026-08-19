#!/usr/bin/env bash
# ControlDesk — Rotate JWT_SECRET + ANON_KEY + SERVICE_ROLE_KEY (rules §22
# secret rotation 90-hari).
#
# Yang dilakukan skrip:
#   1. Backup .env.production ke .env.production.bak-<timestamp>.
#   2. Generate JWT_SECRET baru + turunan ANON_KEY + SERVICE_ROLE_KEY.
#   3. Replace ketiga baris di .env.production.
#   4. Print instruksi rebuild + restart (skrip TIDAK jalan `docker compose`
#      otomatis karena butuh koordinasi maintenance window).
#
# Konsekuensi rotate:
#   - Semua user existing akan force-logout (JWT lama invalid).
#   - Image `app` HARUS di-rebuild karena `NEXT_PUBLIC_SUPABASE_ANON_KEY`
#     di-bake ke browser bundle di build time.
#   - Kong config di-load ulang dari kong.yml (yang refer ke ANON_KEY baru
#     via envsubst — lihat H3 fix di docker-compose.prod.yml).
#
# Usage:
#   cd ~/controldesk
#   ./deploy/scripts/rotate-jwt.sh
#   # Baca output, lalu jalankan perintah rebuild + up yang di-suggest.

set -euo pipefail

ENV_FILE=".env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE tidak ditemukan. Jalankan dari root repo." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl tidak ditemukan." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node tidak ditemukan (butuh Node 20+ untuk sign JWT)." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# 1. Backup.
# -----------------------------------------------------------------------------
BACKUP_FILE=".env.production.bak-$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
echo "[rotate-jwt] backup dibuat: $BACKUP_FILE (permission 600)"

# -----------------------------------------------------------------------------
# 2. Generate JWT_SECRET baru + derive keys.
# -----------------------------------------------------------------------------
NEW_JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')

IAT=$(date +%s)
EXP=$((IAT + 10 * 365 * 24 * 60 * 60))

NEW_KEYS=$(JWT_SECRET="$NEW_JWT_SECRET" IAT="$IAT" EXP="$EXP" node -e "
const crypto = require('node:crypto');
const secret = process.env.JWT_SECRET;
const iat = Number(process.env.IAT);
const exp = Number(process.env.EXP);

function b64url(b) {
  return Buffer.from(b).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function sign(payload) {
  const h = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(h+'.'+p).digest();
  return h+'.'+p+'.'+b64url(sig);
}
const anon = sign({ role:'anon', iss:'supabase', iat, exp });
const sr   = sign({ role:'service_role', iss:'supabase', iat, exp });
process.stdout.write(anon + '\n' + sr + '\n');
")

NEW_ANON_KEY=$(echo "$NEW_KEYS" | sed -n '1p')
NEW_SERVICE_ROLE_KEY=$(echo "$NEW_KEYS" | sed -n '2p')

# -----------------------------------------------------------------------------
# 3. Replace di .env.production.
# -----------------------------------------------------------------------------
# Escape untuk sed — tanda `/` di JWT tidak masalah karena kita pakai `|` delimiter.
sed -i.tmp \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT_SECRET}|" \
  -e "s|^ANON_KEY=.*|ANON_KEY=${NEW_ANON_KEY}|" \
  -e "s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=${NEW_SERVICE_ROLE_KEY}|" \
  "$ENV_FILE"
rm -f "${ENV_FILE}.tmp"

echo "[rotate-jwt] $ENV_FILE updated dengan JWT_SECRET + ANON_KEY + SERVICE_ROLE_KEY baru."
echo ""

# -----------------------------------------------------------------------------
# 4. Print instruksi rebuild.
# -----------------------------------------------------------------------------
cat <<EOF
=================================================================
NEXT STEPS — rebuild + restart stack (DOWNTIME ~2-5 menit)
=================================================================

Notifikasi user dulu kalau butuh window maintenance (semua user akan
force-logout karena JWT lama invalid).

Kemudian jalankan:

  # 1. Rebuild image app (baking NEXT_PUBLIC_SUPABASE_ANON_KEY baru).
  docker compose -f docker-compose.prod.yml --env-file .env.production build app

  # 2. Recreate service yang butuh key baru (bukan cuma restart).
  #    Kenapa recreate? Kong load config saat container start, jadi harus
  #    down + up supaya envsubst pick up SUPABASE_ANON_KEY baru.
  docker compose -f docker-compose.prod.yml --env-file .env.production \\
    up -d --force-recreate app auth rest realtime storage kong

  # 3. Verifikasi (harus semua "Up (healthy)"):
  docker compose -f docker-compose.prod.yml --env-file .env.production ps

  # 4. Smoke test:
  curl -sI https://$(grep '^ROOT_DOMAIN=' "$ENV_FILE" | cut -d= -f2)/api/health | head -1
  # → HTTP/2 200

Kalau ada yang aneh, rollback:
  cp "$BACKUP_FILE" "$ENV_FILE"
  docker compose -f docker-compose.prod.yml --env-file .env.production \\
    up -d --force-recreate app auth rest realtime storage kong

Rules §22 — rotate lagi 90 hari dari sekarang: $(date -d '+90 days' 2>/dev/null || date -v+90d)
=================================================================
EOF
