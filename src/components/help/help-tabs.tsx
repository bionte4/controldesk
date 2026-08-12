"use client";

import { BookOpen, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { HelpAskPanel } from "./help-ask-panel";

/**
 * Tabbed container for `/help`. Wraps the two experiences the user
 * chose in Fase 2:
 *   • "Browse" — the RSC-rendered category cards + client search.
 *     Server content flows in via `browseSlot` children.
 *   • "Ask ControlDesk" — the AI chat panel. Loaded lazily (mount
 *     stays local) so the fetch to `/api/help/ask` only fires on the
 *     first user message.
 *
 * The active tab persists in URL search params so a deep-link with
 * `?tab=ask` opens the chat immediately (useful for CTA buttons in
 * emails and other help pages).
 */
export function HelpTabs({
  browseSlot,
  articleSlugs,
  defaultTab = "browse",
}: {
  browseSlot: ReactNode;
  articleSlugs: readonly string[];
  defaultTab?: "browse" | "ask";
}) {
  const t = useTranslations("help");
  // Uncontrolled default is set from the RSC-derived defaultTab so a
  // deep-link `/help?tab=ask` lands on the chat tab. After that, tabs
  // stay client-controlled (no `router.replace` — the URL doesn't
  // need to be authoritative once the user is here).
  const [tab, setTab] = useState<string>(defaultTab);
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="browse">
          <BookOpen className="size-3.5" aria-hidden />
          {t("tabBrowse")}
        </TabsTrigger>
        <TabsTrigger value="ask">
          <Sparkles className="size-3.5" aria-hidden />
          {t("tabAsk")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="browse" className="mt-6">
        {browseSlot}
      </TabsContent>
      <TabsContent value="ask" className="mt-6">
        <HelpAskPanel articleSlugs={articleSlugs} />
      </TabsContent>
    </Tabs>
  );
}
