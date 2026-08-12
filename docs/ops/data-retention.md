# Data Retention & Cold Archive — Ops Runbook

Related rules: §22 (retention windows), §19 (storage RLS).

ControlDesk keeps three parallel retention lanes:

| Lane | Where | How | Cadence |
| --- | --- | --- | --- |
| **Live** | Postgres tables | Normal reads via app + Supabase | Continuous |
| **Cold archive** | `tenant-archives` bucket | Gzipped NDJSON, per (tenant, table, year) | Weekly cron `/api/cron/archive` |
| **Purge** | `/dev/null` | Only after a matching `data_archives` row exists | Daily cron `/api/cron/retention` |

## Retention windows (rules §22)

| Data class | Archive after | Purge after | Notes |
| --- | --- | --- | --- |
| `security_audit_logs` | 2 years | 7 years | Append-only (trigger). Purge uses `purge_archived_audit_logs()` SECURITY DEFINER. |
| `cash_advances` | 2 years | 10 years | UU 8/1997. |
| `project_expenses` | 2 years | 10 years | UU KUP. |
| `petty_cash_vouchers` | 2 years | 10 years | Physical receipts. |
| `cash_advance_settlements` | 2 years | 10 years | Cascades from parent CA. |
| `employees` (terminated) | — | Anonymised at 5 years | `anonymize_terminated_employee()` — PII scrubbed, FK preserved. |

## Cold archive layout

Storage bucket: `tenant-archives` (private, service-role write, TENANT_ADMIN + GM read).

```
tenant-archives/
  {tenant_id}/
    security_audit_logs/2018.ndjson.gz
    cash_advances/2018.ndjson.gz
    ...
```

Each artifact is:

- Gzipped NDJSON (one JSON object per line, sorted keys).
- Named `{year}.ndjson.gz` covering `[year-01-01T00:00:00Z, year+1-01-01T00:00:00Z)` on `created_at`.
- Referenced by exactly one `data_archives` row with SHA-256 checksum, row count, and byte size.

## Archive job

```bash
# All targets, default year (current year - 2)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://controldesk.app/api/cron/archive

# One target only
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://controldesk.app/api/cron/archive?target=security_audit_logs"

# Dry run — computes checksum + row count, no upload
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://controldesk.app/api/cron/archive?dry_run=true"

# Override year (e.g. backfill)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://controldesk.app/api/cron/archive?year=2019"
```

The job is idempotent per (tenant, target, year): if a matching batch is
already `ARCHIVED`, `PURGED`, or `RESTORED` it is skipped. Only `FAILED`
rows are retried automatically.

## Restore procedure

Rare — only run when an auditor or compliance officer requests it.

### Fast path — via UI (recommended for spot-checks)

TENANT_ADMIN + GENERAL_MANAGER can open **Settings → Data Archives**
(`/settings/archives`). Per row:

- **Download** — mints a 5-minute signed URL and opens the gzip'd NDJSON in
  a new tab. TENANT_ADMIN + GENERAL_MANAGER, audit action `EXPORT` on
  `data_archives`.
- **Verify** — re-downloads the blob server-side, un-gzips, recomputes
  SHA-256, compares to `checksum_sha256`, and stamps
  `status = RESTORED` + `restore_verified_at = now()` on match.
  TENANT_ADMIN only, audit action `UPDATE` on `data_archives`.

Both actions write to `security_audit_logs`, so a compliance officer can
reproduce every download / verify from the audit trail.

### Manual path — via SQL + service role (for bulk restore into a temp schema)

1. Locate the archive row:
   ```sql
   select id, tenant_id, source_table, batch_start, batch_end,
          storage_path, checksum_sha256, row_count, status
     from public.data_archives
    where tenant_id = '<tenant>'
      and source_table = 'security_audit_logs'
      and batch_start >= '2018-01-01Z'
      and batch_end   <= '2019-01-01Z';
   ```
2. Generate a signed URL (service role):
   ```ts
   const { data } = await service.storage
     .from("tenant-archives")
     .createSignedUrl(row.storage_path, 300);
   ```
3. Download and verify checksum:
   ```bash
   curl -o restore.ndjson.gz "$SIGNED_URL"
   gunzip -k restore.ndjson.gz
   sha256sum restore.ndjson  # must match data_archives.checksum_sha256
   wc -l restore.ndjson      # must equal data_archives.row_count
   ```
4. Bulk INSERT to a temporary schema (never overwrite the live table):
   ```sql
   create schema if not exists restored_2018;
   create table restored_2018.security_audit_logs as
     select * from public.security_audit_logs limit 0;
   \copy restored_2018.security_audit_logs from 'restore.ndjson' with (format text);
   ```
5. Mark the artifact as verified in the registry:
   ```sql
   update public.data_archives
      set restore_verified_at = now()
    where id = '<archive_id>';
   ```

**Never re-insert into the live `security_audit_logs` table.** The append-only
trigger will reject the load, and restored rows would violate the audit
timeline.

## Failure recovery

`cron_run_log` records every archive + retention run. A `FAILED` status
means either (a) storage upload failed, (b) checksum inconsistent, or (c)
Supabase Storage was unreachable. Re-run the job with the same year — the
worker upserts by `(tenant_id, source_table, batch_start, batch_end)` so
retries are safe.

If the same batch fails twice in a row, page the on-call engineer. Do NOT
manually mutate `data_archives` rows; the immutability trigger will reject
edits to `checksum_sha256`, `row_count`, or `bytes_written`.

## Secret rotation

`CRON_SECRET` gates every cron endpoint. Rotate at least every 90 days
alongside `SUPABASE_SERVICE_ROLE_KEY` (see `docs/ops/secret-rotation.md`).
