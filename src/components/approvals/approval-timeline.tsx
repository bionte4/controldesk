/**
 * ControlDesk — Reusable approval timeline (rules §9, §14, §23).
 *
 * Consolidates the two hand-rolled `<ol>` timeline blocks that used to live
 * on the Expense detail page and the Cash Advance detail page. Both blocks
 * had the same visual layout (action badge · actor · status transition ·
 * optional comment · right-aligned timestamp) but subtly different data
 * bindings — Expense pulled labels from a Record while CA used a helper
 * function — so this component takes both `actionLabelMap` and a
 * `formatStatus()` callback and lets callers keep the mapping local.
 *
 * ## Design decisions
 *
 * - **RSC-safe.** No `"use client"`, no hooks, no state. Every value comes
 *   in via props. Callers pass fully-resolved i18n strings so this file
 *   avoids the `next-intl` server/client split.
 * - **Actor avatar.** Renders an initials badge (up to 2 chars) in a
 *   muted circle. Falls back to a bullet when the entry has no actor
 *   (e.g. system-generated transitions). No image fetch — keeps the RSC
 *   render synchronous. Callers who need real avatars can swap the
 *   rendered node via a future `renderAvatar` prop.
 * - **Accessibility (rules §23).** Root is `<ol role="list">` with a
 *   caller-supplied `aria-label`; every timestamp is wrapped in `<time
 *   dateTime>` so screen readers announce a machine-parseable date;
 *   avatar circle is `aria-hidden` because the actor name follows
 *   immediately.
 * - **Timezone.** Delegated to `formatInTz()` which reads the default
 *   tenant timezone (rules §18). Callers may pass an explicit `timezone`
 *   if they need to override — otherwise inherits the app default.
 */

import { Badge } from "@/components/ui/badge";
import { formatInTz } from "@/lib/format/date";
import { formatRole, type EmployeeRole } from "@/lib/rbac/roles";
import { cn } from "@/lib/utils";
import type { ApprovalAction } from "@/types/database";

/**
 * Compute up to two initials from a person's full name. Empty / whitespace
 * input returns "" — the caller renders a bullet fallback in that case.
 */
export function initialsFrom(
  name: string | null | undefined,
): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    const w = words[0];
    return (w[0] ?? "").toUpperCase() + (w[1] ?? "").toUpperCase();
  }
  const first = words[0][0] ?? "";
  const last = words[words.length - 1][0] ?? "";
  return (first + last).toUpperCase();
}

/**
 * Minimal shape the timeline needs — deliberately looser than either
 * source table so both `expense_approval_logs` and
 * `cash_advance_approval_logs` rows fit without an adapter.
 */
export type ApprovalTimelineEntry = {
  /**
   * React key. Expense approval logs use a `bigserial` (number); CA
   * approval logs use `uuid` (string). Both flavours are accepted.
   */
  id: string | number;
  action: ApprovalAction;
  /** `null` = system-generated transition (no human actor recorded). */
  actor: { full_name: string | null } | null;
  /** Raw DB role string; formatted for display via `formatRole()`. */
  actor_role: string | null;
  from_status: string;
  to_status: string;
  comment: string | null;
  /** ISO string, converted via `formatInTz()`. */
  created_at: string;
};

export type ApprovalTimelineProps = {
  entries: readonly ApprovalTimelineEntry[];
  /** Mapping ApprovalAction → localised label. */
  actionLabelMap: Record<ApprovalAction, string>;
  /**
   * Mapping ApprovalAction → Tailwind classes for the action badge.
   * Same shape callers already keep per module (see `ACTION_TONE` in
   * `expenses/[id]/page.tsx` and `cash-advances/[id]/page.tsx`).
   */
  actionToneMap: Record<ApprovalAction, string>;
  /**
   * Callback that turns a raw status string into its localised label.
   * Expense uses a plain `Record` lookup; CA uses a helper that spans
   * both legacy and canonical status flavours — hence the callback
   * indirection.
   */
  formatStatus: (status: string) => string;
  /** Shown when `entries.length === 0`. Callers pass the i18n string. */
  emptyLabel: string;
  /** Displayed when `entry.actor` is null. Defaults to "System". */
  systemLabel?: string;
  /** Passed straight through to `formatInTz()`. Optional. */
  timezone?: string;
  /** Datetime format pattern (see `date-fns-tz`). */
  timestampPattern?: string;
  /** Accessible name for the ordered list. */
  ariaLabel?: string;
  className?: string;
  "data-testid"?: string;
};

export function ApprovalTimeline({
  entries,
  actionLabelMap,
  actionToneMap,
  formatStatus,
  emptyLabel,
  systemLabel = "System",
  timezone,
  timestampPattern = "dd MMM, HH:mm",
  ariaLabel = "Approval timeline",
  className,
  "data-testid": testId,
}: ApprovalTimelineProps) {
  if (entries.length === 0) {
    return (
      <p
        data-testid={testId ? `${testId}-empty` : undefined}
        className={cn("p-6 text-sm text-muted-foreground", className)}
      >
        {emptyLabel}
      </p>
    );
  }

  return (
    <ol
      role="list"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn("relative divide-y divide-border/50", className)}
    >
      {entries.map((entry) => {
        const actorName = entry.actor?.full_name?.trim() || systemLabel;
        const inits = initialsFrom(entry.actor?.full_name);
        const roleLabel = entry.actor_role
          ? formatRole(entry.actor_role as EmployeeRole)
          : null;
        return (
          <li
            key={entry.id}
            className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-3"
          >
            <Badge
              variant="outline"
              className={actionToneMap[entry.action]}
            >
              {actionLabelMap[entry.action]}
            </Badge>
            <div
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-full border border-border/40 bg-muted text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {inits || "•"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm">
                <span className="font-medium">{actorName}</span>
                {roleLabel ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {roleLabel}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatStatus(entry.from_status)}
                {" → "}
                {formatStatus(entry.to_status)}
              </p>
              {entry.comment ? (
                <p className="mt-1 text-xs italic text-muted-foreground">
                  “{entry.comment}”
                </p>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              <time dateTime={entry.created_at}>
                {formatInTz(entry.created_at, timestampPattern, timezone)}
              </time>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
