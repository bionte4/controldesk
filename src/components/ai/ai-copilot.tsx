"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Level 3 inline AI copilot — a compact "Draft with AI" affordance
 * you attach next to a `<Textarea>` to refine short business text
 * fields (cash-advance purpose, expense description, etc).
 *
 * ## UX pattern
 *
 *   • Trigger: a small ghost button with a sparkles icon. Fits
 *     inline in a form control row, doesn't fight the label for
 *     attention.
 *   • On click: opens a popover, calls `/api/ai/copilot`, streams
 *     the suggestion into the preview area. Cancel / Accept /
 *     Regenerate buttons underneath.
 *   • Accept replaces the field value via `onAccept`. The user's
 *     original text is preserved until they explicitly confirm —
 *     never destructive without a confirm click.
 *   • Errors (rate limit, quota, not configured) render inline in
 *     the popover as a short alert. The trigger stays available.
 *
 * ## Why not `<HelpHint>` styling?
 *
 * `<HelpHint>` is passive — reveals docs on demand. `<AiCopilot>`
 * is an *action* button — it calls an API and returns work. Using
 * the same icon/shape for both would blur the distinction. Sparkles
 * icon + tinted foreground makes the "AI action" pattern
 * recognisable across the app.
 */

export type AiCopilotSurface =
  | "ca_purpose"
  | "field_ops_justification"
  | "expense_description"
  | "project_description";

export type AiCopilotContext = Record<
  string,
  string | number | undefined | null
>;

type Props = {
  /** Which surface prompt to use. Must match COPILOT_SURFACES on the server. */
  surface: AiCopilotSurface;
  /** Current field value — passed to the model as "user's draft". */
  currentValue: string;
  /**
   * Form context values (project name, amount, etc). The server drops
   * anything not in the surface's whitelist; this component doesn't
   * enforce that — the extra keys are simply ignored server-side.
   */
  context: AiCopilotContext;
  /** Called with the accepted suggestion. Replaces the field value. */
  onAccept: (suggestion: string) => void;
  /** Optional label override for the trigger button. */
  triggerLabel?: string;
  /** Optional className applied to the trigger for layout tweaks. */
  className?: string;
};

type ErrorKind =
  | "rate_limited"
  | "quota_exceeded"
  | "not_configured"
  | "network"
  | null;

const MAX_SUGGESTION_CHARS = 1200;

export function AiCopilot({
  surface,
  currentValue,
  context,
  onAccept,
  triggerLabel,
  className,
}: Props) {
  const t = useTranslations("aiCopilot");
  const [open, setOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [error, setError] = useState<ErrorKind>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runCopilot = useCallback(async () => {
    // Abort any prior in-flight stream — reopening the popover
    // shouldn't concatenate onto the previous suggestion.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSuggestion("");
    setError(null);
    setStreaming(true);

    try {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          surface,
          input: currentValue ?? "",
          context: Object.fromEntries(
            Object.entries(context).filter(
              ([, v]) => v !== undefined && v !== null && v !== "",
            ),
          ),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Parse the JSON error the route returns.
        let kind: ErrorKind = "network";
        if (res.status === 429) kind = "rate_limited";
        else if (res.status === 402) kind = "quota_exceeded";
        else if (res.status === 503) kind = "not_configured";
        setError(kind);
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("network");
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Never let the preview grow unbounded — model shouldn't
        // return this much anyway (maxOutputTokens caps ≤ 240) but
        // guarding against provider weirdness is cheap.
        if (buffer.length > MAX_SUGGESTION_CHARS) {
          buffer = buffer.slice(0, MAX_SUGGESTION_CHARS);
          setSuggestion(buffer);
          controller.abort();
          break;
        }
        setSuggestion(buffer);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError("network");
    } finally {
      setStreaming(false);
    }
  }, [surface, currentValue, context]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        // Fire the request immediately on open so the user sees
        // progress instead of an empty popover.
        void runCopilot();
      } else {
        abortRef.current?.abort();
        setStreaming(false);
      }
    },
    [runCopilot],
  );

  const canAccept = suggestion.trim().length > 0 && !streaming;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={triggerLabel ?? t("triggerLabel")}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "gap-1.5 text-xs text-muted-foreground hover:text-primary",
              className,
            )}
          />
        }
      >
        <Sparkles className="size-3.5" aria-hidden />
        <span>{triggerLabel ?? t("triggerLabel")}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="flex w-96 max-w-[calc(100vw-32px)] flex-col gap-3 p-3 text-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("title")}
          </p>
          {streaming && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {t("streaming")}
            </span>
          )}
        </div>

        {error ? (
          <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {error === "rate_limited" && t("error.rate_limited")}
              {error === "quota_exceeded" && t("error.quota_exceeded")}
              {error === "not_configured" && t("error.not_configured")}
              {error === "network" && t("error.network")}
            </p>
          </div>
        ) : (
          <div
            className="min-h-[80px] whitespace-pre-wrap rounded-md border bg-muted/50 p-2 text-sm leading-relaxed"
            aria-live="polite"
          >
            {suggestion || (
              <span className="text-muted-foreground">
                {streaming ? t("thinking") : t("emptyPreview")}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            <X className="mr-1 size-3.5" aria-hidden />
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runCopilot()}
            disabled={streaming}
          >
            <Sparkles className="mr-1 size-3.5" aria-hidden />
            {t("regenerate")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canAccept}
            onClick={() => {
              onAccept(suggestion.trim());
              setOpen(false);
            }}
          >
            <Check className="mr-1 size-3.5" aria-hidden />
            {t("accept")}
          </Button>
        </div>

        <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
          {t("footerHint")}
        </p>
      </PopoverContent>
    </Popover>
  );
}

