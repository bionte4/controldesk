#!/usr/bin/env bash
# ControlDesk — one-shot local demo starter.
#
# Setelah laptop restart, jalankan script ini dari root repo:
#
#   ./scripts/dev-start.sh
#
# Yang di-start:
#   1. Supabase local stack (12 container) via `supabase start`
#   2. ControlDesk deps: redis + mailpit
#   3. ControlDesk app + ai-insights-cron (production build, port 3001)
#
# Setelah semua up (~60-90 detik), buka:
#   http://localhost:3001            — landing + super admin
#   http://demo.localhost:3001       — tenant demo
#   http://itps.localhost:3001       — tenant itps
#   http://localhost:54323           — Supabase Studio (browse DB)
#   http://localhost:8025            — Mailpit inbox (approver emails)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Warna untuk output biar readable.
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}▶${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }

# -----------------------------------------------------------------------------
# 1. Docker Desktop harus jalan.
# -----------------------------------------------------------------------------
log "cek Docker Desktop..."
if ! docker info >/dev/null 2>&1; then
  err "Docker Desktop tidak jalan. Buka aplikasi Docker dulu, tunggu status 'Engine running' di menubar, lalu jalankan script ini lagi."
  exit 1
fi
ok "Docker OK"

# -----------------------------------------------------------------------------
# 2. .env.local harus ada.
# -----------------------------------------------------------------------------
if [ ! -f .env.local ]; then
  err ".env.local tidak ditemukan. Copy dari .env.local.example dulu:"
  echo "    cp .env.local.example .env.local"
  exit 1
fi
ok ".env.local ditemukan"

# -----------------------------------------------------------------------------
# 3. Start Supabase local stack (idempotent — kalau sudah jalan, cukup verify).
# -----------------------------------------------------------------------------
log "start Supabase local stack (db + auth + realtime + storage + studio)..."
if supabase status >/dev/null 2>&1; then
  ok "Supabase sudah jalan — skip"
else
  supabase start
  ok "Supabase up"
fi

# -----------------------------------------------------------------------------
# 4. Start ControlDesk deps: redis + mailpit.
# -----------------------------------------------------------------------------
log "start redis + mailpit..."
pnpm docker:deps >/dev/null 2>&1
ok "redis + mailpit up"

# -----------------------------------------------------------------------------
# 5. Start ControlDesk app + ai-insights-cron.
# -----------------------------------------------------------------------------
log "start controldesk-app (production build) + ai-insights-cron..."
pnpm docker:app >/dev/null 2>&1

# Tunggu healthcheck app.
log "menunggu healthcheck /api/health..."
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3001/api/health >/dev/null 2>&1; then
    ok "app healthy di port 3001"
    break
  fi
  sleep 2
  if [ "$i" = "30" ]; then
    warn "app belum healthy setelah 60 detik — cek: docker logs controldesk-app"
  fi
done

# -----------------------------------------------------------------------------
# 6. Ringkas status.
# -----------------------------------------------------------------------------
echo
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ControlDesk siap untuk demo!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo
echo "  Landing + super admin  →  http://localhost:3001"
echo "  Tenant demo            →  http://demo.localhost:3001"
echo "  Tenant itps            →  http://itps.localhost:3001"
echo "  Self-signup tenant     →  http://localhost:3001/register-org"
echo
echo "  Support tools:"
echo "    Supabase Studio      →  http://localhost:54323"
echo "    Mailpit (dev email)  →  http://localhost:8025"
echo "    Inbucket (auth)      →  http://localhost:54324"
echo
echo "  Stop semua nanti      →  ./scripts/dev-stop.sh"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
