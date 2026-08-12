/**
 * ControlDesk — Unified finance status badge (rules §14).
 *
 * Every finance surface (Expense / Cash Advance / Budget / Budget Request
 * / Contract) has the same visual pattern for its status pill:
 *
 *     <Badge variant="outline" className={SOME_TONE[status]}>
 *       {SOME_LABEL[status]}
 *     </Badge>
 *
 * Three-line boilerplate repeated in 9+ places. This wrapper consolidates
 * it into a single import, enforces the outline variant so no future edit
 * can silently drift the look, and gives us a single spot to add a
 * semantic prefix icon later (approved = check, rejected = x, etc.) — see
 * Slice 4 or 5 of the Professional Workflow Design plan.
 *
 * ## Why not encode the tone/label maps here?
 *
 * Because each module owns its own status flavour — Expense uses
 * `ExpenseStatus`, CA has canonical + legacy variants that need runtime
 * mapping, Budget Request has its own set. Coupling the badge to a single
 * enum would either (a) explode into a union of every finance status ever
 * (leaks module concerns), or (b) collapse to a string prop that loses
 * type safety. The current split — badge owns *presentation*, caller owns
 * *data mapping* — keeps both concerns isolated and easy to extend.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type FinanceStatusBadgeProps = {
  /** Localised, human-readable status text. */
  label: string;
  /**
   * Tailwind classes for the badge tone (colour + background + border).
   * Callers typically pass a lookup from their module's `*_STATUS_TONE`
   * record.
   */
  tone: string;
  /** Optional extra classes appended after `tone`. */
  className?: string;
  /** Test hook. */
  "data-testid"?: string;
  /**
   * Optional aria-label for screen readers. Rendered as `title` too so
   * long-form context surfaces on hover.
   */
  title?: string;
};

export function FinanceStatusBadge({
  label,
  tone,
  className,
  "data-testid": testId,
  title,
}: FinanceStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(tone, className)}
      data-testid={testId}
      title={title}
    >
      {label}
    </Badge>
  );
}
