#!/usr/bin/env bash
# ControlDesk — Apply semua migration di supabase/migrations/*.sql ke Postgres
# production self-hosted, TANPA butuh Supabase CLI di VPS.
#
# Kenapa perlu?
#   Image `supabase/postgres` hanya jalankan `.sql` di top-level
#   `/docker-entrypoint-initdb.d/`, TIDAK rekursif ke subdir. Volume mount di
#   docker-compose.prod.yml (`./supabase/migrations:...`) karena itu tidak
#   otomatis apply. Kita loop file-nya dari luar container pakai `psql` yang
#   sudah di dalam container `controldesk-db`.
#
# Usage:
#   ./deploy/scripts/apply-migrations.sh
#
#   Optional: set custom DB URL (mis. staging cluster):
#     DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=postgres DB_NAME=postgres \
#       ./deploy/scripts/apply-migrations.sh
#
# Idempotent: setiap file yang sudah pernah di-apply akan di-skip berdasar
# tabel bookkeeping `public._migration_history` (dibikin skrip ini kalau
# belum ada). Aman dijalankan berkali-kali.

set -euo pipefail

# -----------------------------------------------------------------------------
# Config — dibaca dari env atau default sensible.
# -----------------------------------------------------------------------------
DB_HOST="${DB_HOST:-controldesk-db}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/supabase/migrations}"

# POSTGRES_PASSWORD dibaca dari .env.production kalau ada, kalau tidak dari env.
if [ -z "${POSTGRES_PASSWORD:-}" ] && [ -f ".env.production" ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env.production; set +a
fi

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "ERROR: POSTGRES_PASSWORD tidak diset. Isi via .env.production atau export." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Helper — jalankan psql via docker exec (tidak butuh psql di host).
# -----------------------------------------------------------------------------
run_psql() {
  docker exec \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    -i controldesk-db \
    psql -v ON_ERROR_STOP=1 -X -q \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

log() {
  echo "[apply-migrations] $(date +%H:%M:%S) $*"
}

# -----------------------------------------------------------------------------
# 1. Bootstrap bookkeeping table.
# -----------------------------------------------------------------------------
log "bootstrap _migration_history table"
run_psql <<'SQL'
CREATE TABLE IF NOT EXISTS public._migration_history (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  sha256 text
);
SQL

# -----------------------------------------------------------------------------
# 2. Verify migrations directory + gather files.
# -----------------------------------------------------------------------------
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: MIGRATIONS_DIR '$MIGRATIONS_DIR' tidak ditemukan." >&2
  exit 1
fi

# Glob lexicographic (0001_..., 0002_..., dst.) — ini yang bikin urutan konsisten.
mapfile -t files < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

if [ ${#files[@]} -eq 0 ]; then
  echo "ERROR: tidak ada file *.sql di $MIGRATIONS_DIR" >&2
  exit 1
fi

log "menemukan ${#files[@]} file migration di $MIGRATIONS_DIR"

# -----------------------------------------------------------------------------
# 3. Loop apply — skip yang sudah di _migration_history.
# -----------------------------------------------------------------------------
applied_count=0
skipped_count=0
failed_file=""

for f in "${files[@]}"; do
  fname=$(basename "$f")
  # Compute sha256 supaya bisa detect kalau file berubah setelah di-apply
  # (mustinya tidak boleh — rules §22 "DILARANG edit migration yang landing").
  if command -v sha256sum >/dev/null 2>&1; then
    hash=$(sha256sum "$f" | cut -d' ' -f1)
  else
    hash=$(shasum -a 256 "$f" | cut -d' ' -f1)
  fi

  already=$(run_psql -t -A -c "SELECT filename FROM public._migration_history WHERE filename='$fname';" 2>/dev/null || echo "")

  if [ -n "$already" ]; then
    prev_hash=$(run_psql -t -A -c "SELECT COALESCE(sha256,'') FROM public._migration_history WHERE filename='$fname';" 2>/dev/null || echo "")
    if [ -n "$prev_hash" ] && [ "$prev_hash" != "$hash" ]; then
      echo "WARNING: '$fname' sudah applied dengan hash beda. File diubah?" >&2
      echo "  previous: $prev_hash" >&2
      echo "  current:  $hash" >&2
      echo "  Rules §22 melarang edit migration yang landing di main. Investigate." >&2
    fi
    skipped_count=$((skipped_count + 1))
    continue
  fi

  log "APPLY $fname"
  if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" -i controldesk-db \
      psql -v ON_ERROR_STOP=1 -X -q \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$f"; then
    failed_file="$fname"
    echo "ERROR: migration '$fname' gagal. Stop." >&2
    break
  fi

  run_psql -c "INSERT INTO public._migration_history (filename, sha256) VALUES ('$fname', '$hash');" >/dev/null
  applied_count=$((applied_count + 1))
done

# -----------------------------------------------------------------------------
# 4. Summary.
# -----------------------------------------------------------------------------
echo ""
log "=================================="
log "  applied: $applied_count"
log "  skipped: $skipped_count (sudah di history)"
if [ -n "$failed_file" ]; then
  log "  FAILED : $failed_file"
  log "=================================="
  exit 1
fi
log "=================================="

# -----------------------------------------------------------------------------
# 5. Post-apply verification — check critical objects exist.
# -----------------------------------------------------------------------------
log "verifikasi objek critical…"
run_psql <<'SQL' >/dev/null 2>&1 || { echo "ERROR: verification failed" >&2; exit 1; }
DO $$
BEGIN
  -- Function custom_access_token_hook — dibutuhkan GoTrue (migration 0020).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'custom_access_token_hook') THEN
    RAISE EXCEPTION 'custom_access_token_hook function belum ada (migration 0020 belum apply)';
  END IF;

  -- Function provision_tenant — dibutuhkan tenant onboarding (migration 0076).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'provision_tenant') THEN
    RAISE EXCEPTION 'provision_tenant function belum ada (migration 0076 belum apply)';
  END IF;

  -- Function seed_default_master_data — dibutuhkan (migration 0082+0090).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'seed_default_master_data') THEN
    RAISE EXCEPTION 'seed_default_master_data function belum ada (migration 0082 belum apply)';
  END IF;

  -- Function seed_default_eval_templates — dibutuhkan (migration 0088).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'seed_default_eval_templates') THEN
    RAISE EXCEPTION 'seed_default_eval_templates function belum ada (migration 0088 belum apply)';
  END IF;

  -- Tabel core yang wajib.
  PERFORM 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants';
  IF NOT FOUND THEN RAISE EXCEPTION 'public.tenants tidak ada'; END IF;

  PERFORM 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='employees';
  IF NOT FOUND THEN RAISE EXCEPTION 'public.employees tidak ada'; END IF;

  PERFORM 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='security_audit_logs';
  IF NOT FOUND THEN RAISE EXCEPTION 'public.security_audit_logs tidak ada'; END IF;

  RAISE NOTICE 'Semua objek critical terverifikasi. Migration OK.';
END $$;
SQL

log "OK — migration + verification selesai."
