#!/usr/bin/env sh
# Generate semua secret non-JWT untuk .env.production.
#
# Usage:
#   ./deploy/scripts/generate-secrets.sh
#
# Output: printed ke stdout. Salin ke `.env.production` di slot yang sesuai.
# Semua secret dibuat dengan `openssl rand` — cryptographically secure.

set -eu

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl tidak ditemukan. Install dulu (mis. brew install openssl / apk add openssl)." >&2
  exit 1
fi

# Helper generator — base64 URL-safe, buang line breaks.
gen() {
  openssl rand -base64 "$1" | tr -d '\n=/+' | head -c "$1"
}

cat <<EOF
# ---------------------------------------------------------------------------
# Salin baris di bawah ke .env.production (replace nilai yang sudah ada).
# JANGAN commit hasilnya ke git.
# ---------------------------------------------------------------------------

POSTGRES_PASSWORD=$(gen 32)
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
REALTIME_ENC_KEY=$(gen 24)
REALTIME_SECRET_KEY_BASE=$(openssl rand -base64 48 | tr -d '\n')
APP_ENCRYPTION_KEY=$(gen 32)
CRON_SECRET=$(gen 32)
DASHBOARD_PASSWORD=$(gen 24)

# ---------------------------------------------------------------------------
# LANGKAH BERIKUTNYA:
#   1. Salin JWT_SECRET ke .env.production dulu.
#   2. Jalankan: ./deploy/scripts/generate-supabase-keys.sh
#      (butuh Node.js + JWT_SECRET dari langkah 1).
#   3. Salin ANON_KEY + SERVICE_ROLE_KEY ke .env.production.
# ---------------------------------------------------------------------------
EOF
