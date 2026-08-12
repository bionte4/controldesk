"use client";

import Link from "next/link";
import { ArrowUpRight, HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Inline contextual help — a small `?` icon next to a form field,
 * table header, or feature button. Click reveals a popover with a
 * short explanation + optional deep link to the full help article.
 *
 * ## When to use
 *
 * Use `<HelpHint>` when the user is more likely to be blocked than
 * curious. Great targets:
 *   • Threshold input fields ("mengapa 5 jt?").
 *   • Enum dropdowns with cryptic options ("apa itu FieldOps?").
 *   • Approval slot columns in tables.
 *   • Toggles with non-obvious side effects.
 *
 * Do NOT use `<HelpHint>` as a substitute for good copy or labels.
 * If a `<Label>` needs three sentences to make sense, rewrite the
 * label. The hint is for the *edge* case that the label already
 * covers 90% of.
 *
 * ## Props
 *
 * - `title` (required) — one-line header, plain text.
 * - `children` (required) — the body content. Keep to ~1-3 short
 *   sentences; longer explanations belong in a full article.
 * - `articleSlug` (optional) — slug from `HELP_MANIFEST`. If set, an
 *   "Open full guide →" link appears under the body pointing to
 *   `/help/{articleSlug}`.
 * - `ariaLabel` (optional) — override the default trigger a11y label
 *   ("Show help") for high-density UIs where multiple hints could
 *   otherwise be indistinguishable to screen readers.
 * - `className` — pass through to the trigger button for spacing.
 *
 * ## Accessibility
 *
 * The trigger is a real `<button>` (not a `<span>`) so it's in the
 * keyboard tab order and receives focus rings. Screen reader
 * announces the aria-label; the popover content is live-region
 * neutral (no interruption) since the user explicitly opened it.
 */
type HelpHintProps = {
  title: string;
  children: React.ReactNode;
  articleSlug?: string;
  ariaLabel?: string;
  className?: string;
};

export function HelpHint({
  title,
  children,
  articleSlug,
  ariaLabel,
  className,
}: HelpHintProps) {
  const t = useTranslations("help");
  const label = ariaLabel ?? t("hintTrigger", { title });

  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 text-muted-foreground hover:text-foreground",
              className,
            )}
          />
        }
      >
        <HelpCircle className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-32px)] text-sm"
      >
        <div className="flex flex-col gap-2">
          <p className="font-semibold leading-tight">{title}</p>
          <div className="text-muted-foreground [&_p]:m-0 [&_p+p]:mt-2">
            {children}
          </div>
          {articleSlug && (
            <Link
              href={`/help/${articleSlug}`}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t("openFullGuide")}
              <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
