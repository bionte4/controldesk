#!/usr/bin/env bash
# ControlDesk — stop semua service lokal (kebalikan dari dev-start.sh).
#
# Usage:
#   ./scripts/dev-stop.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}▶${NC} $*"; }
ok()  { echo -e "${GREEN}✓${NC} $*"; }

log "stop ControlDesk app + ai-insights-cron..."
pnpm docker:app:down >/dev/null 2>&1 || true
ok "app stopped"

log "stop redis + mailpit..."
pnpm docker:deps:down >/dev/null 2>&1 || true
ok "deps stopped"

log "stop Supabase local stack..."
supabase stop >/dev/null 2>&1 || true
ok "Supabase stopped"

echo
ok "Semua service ControlDesk di-stop. Data tetap tersimpan di Docker volume."
