#!/bin/sh
# ControlDesk — nightly pg_dump backup ke S3-compatible storage.
#
# Dipanggil oleh sidecar container `backup` via cron (docker-compose.prod.yml).
# Bisa juga dijalankan manual dari host untuk on-demand backup:
#
#   docker exec controldesk-backup /usr/local/bin/backup.sh
#
# Env yang dipakai (di-inject via docker-compose):
#   POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
#   BACKUP_RETENTION_DAILY  (jumlah hari retensi daily backup)

set -eu

LOG_TAG="[backup]"
DATE_TAG=$(date +%Y%m%d-%H%M%S)
DAY_TAG=$(date +%Y%m%d)
BACKUP_FILE="/var/cache/backups/controldesk-${DATE_TAG}.sql.gz"

log() {
  echo "${LOG_TAG} $(date -Iseconds) $*"
}

# -----------------------------------------------------------------------------
# 1. Sanity check — semua env harus di-set.
# -----------------------------------------------------------------------------
require_env() {
  var_name="$1"
  eval "value=\${$var_name:-}"
  if [ -z "$value" ]; then
    log "ERROR: env '$var_name' tidak diset — skip backup."
    exit 1
  fi
}

require_env POSTGRES_HOST
require_env POSTGRES_USER
require_env POSTGRES_PASSWORD
require_env POSTGRES_DB

# S3 opsional — kalau tidak diset, backup tetap tersimpan di volume lokal
# (`backup-cache`) tapi tidak di-upload. Warn tapi jangan gagal.
S3_ENABLED=1
for v in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
  eval "value=\${$v:-}"
  if [ -z "$value" ]; then
    log "WARN: env '$v' tidak diset — skip S3 upload (lokal-only backup)."
    S3_ENABLED=0
    break
  fi
done

# -----------------------------------------------------------------------------
# 2. pg_dump — pakai custom format + compression.
# -----------------------------------------------------------------------------
log "start backup ke $BACKUP_FILE"
export PGPASSWORD="$POSTGRES_PASSWORD"

# --clean --if-exists supaya restore idempotent.
# --no-owner + --no-privileges supaya restore ke cluster fresh gampang.
pg_dump \
  --host="$POSTGRES_HOST" \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip -9 > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "pg_dump OK — size $BACKUP_SIZE"

# -----------------------------------------------------------------------------
# 3. Upload ke S3-compatible (opsional).
# -----------------------------------------------------------------------------
if [ "$S3_ENABLED" -eq 1 ]; then
  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY"
  export AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
  export AWS_DEFAULT_REGION=auto

  S3_KEY="daily/${DAY_TAG}/controldesk-${DATE_TAG}.sql.gz"
  log "upload ke s3://${S3_BUCKET}/${S3_KEY}"

  aws --endpoint-url "$S3_ENDPOINT" s3 cp \
    "$BACKUP_FILE" \
    "s3://${S3_BUCKET}/${S3_KEY}" \
    --storage-class STANDARD

  log "upload OK"

  # -------------------------------------------------------------------------
  # 4. Retention prune — hapus backup daily > BACKUP_RETENTION_DAILY hari.
  # -------------------------------------------------------------------------
  RETENTION_DAYS="${BACKUP_RETENTION_DAILY:-30}"
  CUTOFF_DATE=$(date -d "$RETENTION_DAYS days ago" +%Y%m%d 2>/dev/null \
    || date -v-"${RETENTION_DAYS}d" +%Y%m%d 2>/dev/null \
    || echo "")

  if [ -n "$CUTOFF_DATE" ]; then
    log "prune backup < $CUTOFF_DATE (retention $RETENTION_DAYS hari)"
    aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://${S3_BUCKET}/daily/" \
      | awk '{print $2}' \
      | sed 's|/||' \
      | while read -r day; do
          if [ -n "$day" ] && [ "$day" \< "$CUTOFF_DATE" ]; then
            log "prune s3://${S3_BUCKET}/daily/${day}/"
            aws --endpoint-url "$S3_ENDPOINT" s3 rm \
              "s3://${S3_BUCKET}/daily/${day}/" --recursive
          fi
        done
  fi
fi

# -----------------------------------------------------------------------------
# 5. Cleanup local — simpan max 7 hari di volume lokal supaya volume tidak
# penuh. Backup lama tetap di S3.
# -----------------------------------------------------------------------------
find /var/cache/backups -name 'controldesk-*.sql.gz' -mtime +7 -delete 2>/dev/null || true

log "done"
