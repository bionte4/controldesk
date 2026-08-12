/**
 * ControlDesk — Reusable approval-chain visualisation (rules §9, §14).
 *
 * Consolidates three previously-duplicated inline chain renderings
 * (approvals inbox, budget-requests list, cash-advance preview) into one
 * accessible component. Two variants:
 *
 *   - "compact"  → tight pills, indigo tint on the currently-pending slot,
 *                  optional emerald tint on completed slots. Used inline
 *                  in tables/rows.
 *   - "preview"  → primary-tinted pills with `→` between them. Used in
 *                  forms to preview which chain a submission will follow.
 *
 * Accessibility (rules §23):
 *   - Renders as an ordered list (`<ol role="list">`).
 *   - Each pill has an `aria-current="step"` when it is the active slot.
 *   - Icons decorative with `aria-hidden`.
 */

import { ArrowRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export type ApprovalChainProgressProps = {
  /** Ordered list of slot identifiers, e.g. `["L1", "L2", "FIN", "L3"]`. */
  slots: readonly string[];
  /** The slot currently awaiting action, or null when nothing is pending. */
  active?: string | null;
  /**
   * Slots already resolved (fully approved/completed). These render in an
   * emerald tone when provided. When `active` is set but `completed` isn't,
   * we auto-derive: all slots ordered strictly before `active`.
   */
  completed?: readonly string[];
  /** Visual style. `compact` (default) = pills only. `preview` = pills + arrows. */
  variant?: "compact" | "preview";
  /** Text size. Defaults to `xs` to match existing surfaces. */
  size?: "xs" | "sm";
  /** Optional label mapper — receives raw slot id, returns display text. */
  renderSlot?: (slot: string) => React.ReactNode;
  /** Optional accessible label (falls back to "Approval chain"). */
  ariaLabel?: string;
  /** Extra classes for the root `ol`. */
  className?: string;
  /** Optional data-testid to help E2E selectors. */
  "data-testid"?: string;
};

export function ApprovalChainProgress({
  slots,
  active,
  completed,
  variant = "compact",
  size = "xs",
  renderSlot,
  ariaLabel,
  className,
  "data-testid": testId,
}: ApprovalChainProgressProps) {
  const completedSet = React.useMemo(() => {
    if (completed) return new Set(completed);
    if (!active) return new Set<string>();
    const derived = new Set<string>();
    for (const s of slots) {
      if (s === active) break;
      derived.add(s);
    }
    return derived;
  }, [active, completed, slots]);

  const showArrows = variant === "preview";
  const textSize = size === "sm" ? "text-sm" : "text-xs";

  return (
    <ol
      role="list"
      aria-label={ariaLabel ?? "Approval chain"}
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-center",
        showArrows ? "gap-1.5" : "gap-1",
        textSize,
        className,
      )}
    >
      {slots.map((slot, idx) => {
        const isActive = slot === active;
        const isCompleted = completedSet.has(slot);
        return (
          <li key={`${slot}-${idx}`} className="flex items-center gap-1.5">
            <span
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "rounded-md border px-1.5 py-0.5 leading-none",
                isActive
                  ? "border-indigo-400/60 bg-indigo-500/10 text-indigo-300"
                  : isCompleted
                    ? "border-emerald-400/40 bg-emerald-500/5 text-emerald-300"
                    : variant === "preview"
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-border/60 text-muted-foreground",
              )}
            >
              {renderSlot ? renderSlot(slot) : slot}
            </span>
            {showArrows && idx < slots.length - 1 ? (
              <ArrowRight
                aria-hidden="true"
                className="size-3 text-muted-foreground"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
