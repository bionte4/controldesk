/**
 * ControlDesk — Next-action hint banner (rules §14).
 *
 * On every finance detail page, an approver arrives and asks the same
 * questions in the same order:
 *
 *   1. Where is this in the workflow? (pending / approved / rejected)
 *   2. Who's turn is it next?
 *   3. What can *I* do right now?
 *
 * The status pill answers (1) in one word but forces the eye to bounce
 * to the timeline / chain progress to answer (2), and to scan for the
 * action buttons to answer (3). This component collapses all three into
 * a single glanceable banner directly above the action bar:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  ⏳  Menunggu approval FINANCE                │
 *   │     Amount melewati threshold PM              │
 *   │     [Approve]  [Reject]                       │  ← action-bar
 *   └──────────────────────────────────────────────┘
 *
 * The component owns the visual language (icon, color, layout,
 * accessibility) and lets callers decide the copy — every module has
 * its own state machine and localised wording.
 *
 * ## Design decisions
 *
 * - **RSC-safe.** No hooks, no state. Every value from props.
 * - **Semantic intent enum.** Callers pick from a fixed set of five
 *   flavours (`pending / approved / rejected / cancelled / info`) so
 *   the palette stays consistent across modules — a "rejected" banner
 *   on Expense and on Budget must feel identical.
 * - **Accessibility.** Uses `role="status"` + `aria-live="polite"` so
 *   screen readers announce the workflow state as it re-renders after
 *   an approval action. Icon is `aria-hidden` because the headline is
 *   the meaningful signal.
 * - **Slot for extras.** `children` renders below the description —
 *   callers put action buttons, a chain progress, or an SLA hint
 *   there. Keeps the banner monolithic without leaking layout
 *   concerns.
 */

import * as React from "react";
import {
  Ban,
  CheckCircle2,
  Clock,
  Info,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Semantic status flavour. Drives icon, background, border, and text
 * colours. Extend cautiously — every additional intent implies a new
 * design decision that must be signed off by UX.
 */
export type NextActionHintIntent =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "info";

const INTENT_STYLES: Record<
  NextActionHintIntent,
  {
    container: string;
    icon: React.ReactNode;
    iconWrapper: string;
    heading: string;
  }
> = {
  pending: {
    container:
      "border-primary/30 bg-primary/5 [--hint-fg:theme(colors.primary.DEFAULT)]",
    icon: <Clock className="size-5" aria-hidden />,
    iconWrapper: "bg-primary/15 text-primary",
    heading: "text-primary",
  },
  approved: {
    container:
      "border-emerald-500/40 bg-emerald-500/10 [--hint-fg:theme(colors.emerald.500)]",
    icon: <CheckCircle2 className="size-5" aria-hidden />,
    iconWrapper: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    heading: "text-emerald-700 dark:text-emerald-300",
  },
  rejected: {
    container:
      "border-rose-500/40 bg-rose-500/10 [--hint-fg:theme(colors.rose.500)]",
    icon: <XCircle className="size-5" aria-hidden />,
    iconWrapper: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    heading: "text-rose-700 dark:text-rose-300",
  },
  cancelled: {
    container: "border-border bg-muted/40",
    icon: <Ban className="size-5" aria-hidden />,
    iconWrapper: "bg-muted text-muted-foreground",
    heading: "text-foreground",
  },
  info: {
    container: "border-border bg-muted/30",
    icon: <Info className="size-5" aria-hidden />,
    iconWrapper: "bg-muted text-foreground",
    heading: "text-foreground",
  },
};

export type NextActionHintProps = {
  /** Drives colour palette + default icon. */
  intent: NextActionHintIntent;
  /** Primary headline (e.g. "Menunggu approval FINANCE"). */
  title: string;
  /** Optional secondary line (e.g. "Amount melewati threshold PM"). */
  description?: React.ReactNode;
  /**
   * Optional custom icon override. Defaults to the intent's icon
   * (Clock for pending, CheckCircle for approved, etc.).
   */
  icon?: React.ReactNode;
  /**
   * Extra content slot below the description — action buttons,
   * chain progress, SLA badge, whatever the caller needs. Rendered
   * with a small top margin.
   */
  children?: React.ReactNode;
  /** Test hook. */
  "data-testid"?: string;
  /** Extra classes appended to the container. */
  className?: string;
};

export function NextActionHint({
  intent,
  title,
  description,
  icon,
  children,
  "data-testid": testId,
  className,
}: NextActionHintProps) {
  const styles = INTENT_STYLES[intent];
  return (
    <section
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-intent={intent}
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4",
        styles.container,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full",
            styles.iconWrapper,
          )}
        >
          {icon ?? styles.icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", styles.heading)}>
            {title}
          </p>
          {description ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {children ? <div className="pl-12">{children}</div> : null}
    </section>
  );
}
