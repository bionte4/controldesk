"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { AskAiSheet } from "@/components/help/ask-ai-sheet";
import { cn } from "@/lib/utils";

/**
 * Global "Ask AI" launcher — a gradient-bordered pill that lives in
 * the AppTopbar, opens a slide-in drawer with a compact chat surface.
 *
 * The pill collapses to icon-only on small viewports (< md) so it
 * doesn't crowd the topbar next to breadcrumbs. On md+ it shows the
 * label alongside the icon, exactly like the Hostinger "Tanya AI"
 * pattern the product spec references.
 *
 * All state is local to this component so the topbar can stay
 * unchanged aside from mounting the trigger — the sheet portals into
 * the document body so it can render over sidebar / breadcrumb chrome
 * without z-index gymnastics.
 */
export function AskAiTrigger({
  firstName,
  articleSlugs,
}: {
  firstName: string;
  articleSlugs: readonly string[];
}) {
  const t = useTranslations("askAi");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("triggerLabel")}
        aria-haspopup="dialog"
        aria-expanded={open}
        // Gradient border via `p-[1px]` outer wrapper filled with a
        // gradient, and an inner `bg-background` that "eats" the
        // centre so only the 1px rim shows the colour. Keeps the
        // trigger looking hi-tech without a full colour bloom that
        // would clash with the neutral topbar palette.
        className={cn(
          "group relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-full p-[1.5px] transition-shadow",
          "bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500",
          "hover:shadow-[0_0_16px_rgba(139,92,246,0.35)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <span className="inline-flex h-full items-center gap-1.5 rounded-full bg-background px-2.5 text-xs font-medium text-foreground transition-colors group-hover:bg-background/80 sm:px-3">
          <Sparkles
            className="size-3.5 text-indigo-500 dark:text-indigo-400"
            aria-hidden
          />
          <span className="hidden md:inline">{t("triggerLabel")}</span>
        </span>
      </button>

      <AskAiSheet
        open={open}
        onOpenChange={setOpen}
        firstName={firstName}
        articleSlugs={articleSlugs}
      />
    </>
  );
}
