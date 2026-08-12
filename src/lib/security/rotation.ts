/**
 * ControlDesk — secret-rotation status helpers (rules §22).
 *
 * Mirrors the `public.secret_rotation_status()` SQL function so we can
 * compute severity from any client (cron worker, ops UI, unit test)
 * without a round-trip. The DB function is still the source of truth in
 * production — this module is used for:
 *
 *   • Server-side cron dispatch decisions (WARN vs OVERDUE payloads).
 *   • Deterministic unit tests without a Postgres process.
 *
 * WARN threshold matches the SQL: severity flips WARN 14 days before the
 * `rotation_interval_days` deadline.
 */

import type {
  SecretPriority,
  SecretRotationSeverity,
} from "@/types/database";

export const WARN_WINDOW_DAYS = 14;

export type SecretRotationRow = {
  name: string;
  priority: SecretPriority;
  purpose: string;
  last_rotated_at: string; // ISO
  rotation_interval_days: number;
  last_rotated_by?: string | null;
  notes?: string | null;
};

export type SecretRotationComputed = SecretRotationRow & {
  days_since_rotation: number;
  days_until_due: number;
  severity: SecretRotationSeverity;
};

/**
 * Compute `severity` + day counters for a single secret. Pure; safe to
 * import from anywhere.
 */
export function computeStatus(
  row: SecretRotationRow,
  now: Date = new Date(),
): SecretRotationComputed {
  const rotatedAt = new Date(row.last_rotated_at);
  const parsed = rotatedAt.getTime();
  if (Number.isNaN(parsed)) {
    // Treat unparseable timestamps as "never rotated" — safest default.
    return {
      ...row,
      days_since_rotation: Number.POSITIVE_INFINITY,
      days_until_due: Number.NEGATIVE_INFINITY,
      severity: "OVERDUE",
    };
  }

  const elapsedMs = now.getTime() - parsed;
  const daysSince = Math.floor(elapsedMs / 86_400_000);
  const interval = Math.max(1, row.rotation_interval_days);
  const untilDue = interval - daysSince;

  let severity: SecretRotationSeverity;
  if (untilDue < 0) {
    severity = "OVERDUE";
  } else if (untilDue <= WARN_WINDOW_DAYS) {
    severity = "WARN";
  } else {
    severity = "OK";
  }

  return {
    ...row,
    days_since_rotation: daysSince,
    days_until_due: untilDue,
    severity,
  };
}

/**
 * Bulk variant that also sorts by "attention needed": OVERDUE first, then
 * WARN, then OK, and within each bucket by soonest `days_until_due`
 * ascending. Handy for the ops UI + cron summary.
 */
export function computeAll(
  rows: readonly SecretRotationRow[],
  now: Date = new Date(),
): SecretRotationComputed[] {
  const computed = rows.map((r) => computeStatus(r, now));
  const rank: Record<SecretRotationSeverity, number> = {
    OVERDUE: 0,
    WARN: 1,
    OK: 2,
  };
  return computed.sort((a, b) => {
    const s = rank[a.severity] - rank[b.severity];
    if (s !== 0) return s;
    return a.days_until_due - b.days_until_due;
  });
}

/**
 * Filter helper — the cron dispatcher only cares about actionable rows.
 */
export function filterAttention(
  rows: readonly SecretRotationComputed[],
): SecretRotationComputed[] {
  return rows.filter(
    (r) => r.severity === "WARN" || r.severity === "OVERDUE",
  );
}

/**
 * Group counts for the digest email + cron_run_log details column.
 */
export function summarize(rows: readonly SecretRotationComputed[]): {
  ok: number;
  warn: number;
  overdue: number;
  total: number;
} {
  let ok = 0;
  let warn = 0;
  let overdue = 0;
  for (const r of rows) {
    if (r.severity === "OK") ok += 1;
    else if (r.severity === "WARN") warn += 1;
    else overdue += 1;
  }
  return { ok, warn, overdue, total: rows.length };
}
