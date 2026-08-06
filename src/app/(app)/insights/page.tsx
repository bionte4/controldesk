import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatInTz } from "@/lib/format/date";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AI_INSIGHT_KINDS } from "@/lib/ai/schemas";
import type {
  AiInsightKind,
  AiInsightSeverity,
  Json,
} from "@/types/database";

import { RunAllInsightsButton, RunOneInsightButton } from "./run-insight-buttons";

export const metadata: Metadata = { title: "AI Insights" };

type InsightRow = {
  id: string;
  kind: AiInsightKind;
  severity: AiInsightSeverity;
  headline: string;
  summary: string;
  payload: Json;
  prompt_version: string;
  model_id: string;
  tokens_input: number;
  tokens_output: number;
  latency_ms: number;
  created_at: string;
};

const SEVERITY_TONE: Record<AiInsightSeverity, string> = {
  INFO: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  WARNING: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  CRITICAL: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

async function loadLatestByKind(): Promise<Map<AiInsightKind, InsightRow>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_insights")
    .select(
      "id, kind, severity, headline, summary, payload, prompt_version, model_id, tokens_input, tokens_output, latency_ms, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(80);

  const map = new Map<AiInsightKind, InsightRow>();
  for (const row of (data ?? []) as InsightRow[]) {
    if (!map.has(row.kind)) map.set(row.kind, row);
  }
  return map;
}

export default async function InsightsPage() {
  const [_employee, latest, t] = await Promise.all([
    requireCurrentEmployee(),
    loadLatestByKind(),
    getTranslations("insights"),
  ]);
  void _employee;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <RunAllInsightsButton />
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {AI_INSIGHT_KINDS.map((kind) => {
          const row = latest.get(kind as AiInsightKind);
          return (
            <Card key={kind} className="glass flex flex-col">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <Sparkles className="size-3.5 text-primary" />
                    <span className="label-meta">{t(`kinds.${kind}.title`)}</span>
                  </div>
                  <CardTitle className="line-clamp-2 text-base">
                    {row?.headline ?? t(`kinds.${kind}.empty`)}
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    {t(`kinds.${kind}.description`)}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {row ? (
                    <Badge
                      variant="outline"
                      className={SEVERITY_TONE[row.severity]}
                    >
                      {t(`severity.${row.severity}`)}
                    </Badge>
                  ) : null}
                  <RunOneInsightButton kind={kind as AiInsightKind} />
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                {row ? (
                  <>
                    <p className="text-sm text-muted-foreground line-clamp-4">
                      {row.summary}
                    </p>
                    <Separator className="my-4" />
                    <dl className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                      <div>
                        <dt className="label-meta">{t("meta.model")}</dt>
                        <dd className="mt-0.5 font-mono text-[11px] text-foreground">
                          {row.model_id}
                        </dd>
                      </div>
                      <div>
                        <dt className="label-meta">{t("meta.tokens")}</dt>
                        <dd className="mt-0.5 text-[11px] text-foreground">
                          {row.tokens_input}/{row.tokens_output}
                        </dd>
                      </div>
                      <div>
                        <dt className="label-meta">{t("meta.latency")}</dt>
                        <dd className="mt-0.5 text-[11px] text-foreground">
                          {row.latency_ms}ms
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {t("meta.generatedAt", {
                        date: formatInTz(row.created_at, "dd MMM yyyy, HH:mm"),
                      })}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("noRunYet")}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
