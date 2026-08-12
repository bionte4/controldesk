/**
 * ControlDesk — data retention windows (rules §22).
 *
 * Central source of truth for how long each class of data lives before it
 * is soft-deleted, archived, or hard-purged. Any cron job that trims data
 * MUST import these constants — no inline literals.
 *
 * Legal & regulatory notes (Indonesia):
 *   - Bank / financial records: 10 years (UU 8/1997).
 *   - Payroll / tax records: 10 years (UU KUP).
 *   - HR / employment: 5 years post-termination minimum.
 *   - PII (audit reads, session logs): 12 months rolling.
 *
 * Retention math:
 *   `hard_purge_after_days` — row is permanently deleted from Postgres.
 *   `archive_after_days`    — row is exported to cold storage first.
 *   `soft_delete_after_days` — row is `is_deleted = true` but still queryable
 *                              by admins for the archive window.
 */

export type RetentionPolicy = {
  /** Human-readable name of the policy target. */
  name: string;
  /** After this many days, mark rows as soft-deleted. `null` = never. */
  soft_delete_after_days: number | null;
  /** After this many days total, export to cold storage. `null` = skip. */
  archive_after_days: number | null;
  /** After this many days total, hard delete from Postgres. `null` = never. */
  hard_purge_after_days: number | null;
  /** Free-form note surfaced in the ops dashboard + logs. */
  note?: string;
};

export const RETENTION_POLICIES = {
  security_audit_logs: {
    name: "security_audit_logs",
    // Audit trail: keep 7 years (rules §22 + Indonesian financial regs).
    soft_delete_after_days: null,
    archive_after_days: 365 * 2,
    hard_purge_after_days: 365 * 7,
    note: "Immutable audit trail. Cold archive at year 2, purge at year 7.",
  },
  notifications: {
    name: "notifications",
    // Chatty; keep only 90 days for read notifications.
    soft_delete_after_days: 90,
    archive_after_days: null,
    hard_purge_after_days: 180,
    note: "Read notifications >90d soft-delete; hard-purge at 180d.",
  },
  ai_insights: {
    name: "ai_insights",
    // Model outputs — regenerate cheaply, so purge aggressively.
    soft_delete_after_days: 30,
    archive_after_days: null,
    hard_purge_after_days: 90,
    note: "AI outputs are re-derivable. Keep 30d in UI, purge at 90d.",
  },
  cash_advance_settlements_receipts: {
    name: "cash_advance_settlements_receipts",
    // Financial substantiation — 10 years per UU 8/1997.
    soft_delete_after_days: null,
    archive_after_days: 365 * 2,
    hard_purge_after_days: 365 * 10,
    note: "Bank / expense receipts. 10-year retention for tax audits.",
  },
  petty_cash_vouchers_receipts: {
    name: "petty_cash_vouchers_receipts",
    soft_delete_after_days: null,
    archive_after_days: 365 * 2,
    hard_purge_after_days: 365 * 10,
    note: "Petty cash bukti physik. 10-year retention.",
  },
  project_expenses: {
    name: "project_expenses",
    // 10-year retention (UU KUP). Archived after 2 years to cold storage.
    soft_delete_after_days: null,
    archive_after_days: 365 * 2,
    hard_purge_after_days: 365 * 10,
    note: "Approved / rejected expenses. 10-year retention. Archive at year 2.",
  },
  cash_advances: {
    name: "cash_advances",
    soft_delete_after_days: null,
    archive_after_days: 365 * 2,
    hard_purge_after_days: 365 * 10,
    note: "Cash advance headers. 10-year retention. Archive at year 2.",
  },
  hr_requests: {
    name: "hr_requests",
    // Employment record: 5 years post-close.
    soft_delete_after_days: null,
    archive_after_days: 365 * 2,
    hard_purge_after_days: 365 * 5,
    note: "Leave/overtime records. 5-year retention post-approval.",
  },
  employee_rosters: {
    name: "employee_rosters",
    // Roster history: 2 years (payroll dispute lookback).
    soft_delete_after_days: null,
    archive_after_days: 365,
    hard_purge_after_days: 365 * 2,
    note: "Shift roster history. 2-year lookback for payroll disputes.",
  },
} as const satisfies Record<string, RetentionPolicy>;

export type RetentionTarget = keyof typeof RETENTION_POLICIES;

export function getRetentionPolicy(target: RetentionTarget): RetentionPolicy {
  return RETENTION_POLICIES[target];
}

/**
 * Archive-eligible targets whose rows must be exported to cold storage
 * before any hard-purge. Kept explicit so a policy change here forces a
 * matching UI + runbook update.
 */
export const ARCHIVE_TARGETS = {
  security_audit_logs: {
    source_table: "security_audit_logs" as const,
    time_column: "created_at" as const,
    /**
     * Batch rows by ISO year (audit is high volume). Formats
     * `{yyyy}` — one artifact per calendar year per tenant.
     */
    batch_granularity: "year" as const,
  },
  cash_advance_settlements: {
    source_table: "cash_advance_settlements" as const,
    time_column: "created_at" as const,
    batch_granularity: "year" as const,
  },
  petty_cash_vouchers: {
    source_table: "petty_cash_vouchers" as const,
    time_column: "created_at" as const,
    batch_granularity: "year" as const,
  },
  project_expenses: {
    source_table: "project_expenses" as const,
    time_column: "created_at" as const,
    batch_granularity: "year" as const,
  },
  cash_advances: {
    source_table: "cash_advances" as const,
    time_column: "created_at" as const,
    batch_granularity: "year" as const,
  },
} as const;

export type ArchiveTarget = keyof typeof ARCHIVE_TARGETS;

export const ARCHIVE_BUCKET = "tenant-archives" as const;

/**
 * Compute the [start, end) UTC ISO boundaries for a `year`-granular batch.
 * `year` is the batch's own calendar year (UTC). Not the current year.
 */
export function yearBatchRange(year: number): {
  start_iso: string;
  end_iso: string;
} {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));
  return { start_iso: start.toISOString(), end_iso: end.toISOString() };
}

/**
 * Build the deterministic storage path for a batch. Keeping the shape
 * stable is critical — the retention worker + the ops restore runbook
 * both derive the artifact URL from this same helper.
 */
export function buildArchivePath(input: {
  tenant_id: string;
  source_table: ArchiveTarget;
  year: number;
}): string {
  return `${input.tenant_id}/${input.source_table}/${input.year}.ndjson.gz`;
}
