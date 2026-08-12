import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateOnly } from "@/lib/format/date";
import { toCanonicalRole } from "@/lib/rbac/roles";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  canonicalRecommendation,
  type ContractRecommendation,
  type EvaluationStatus,
  type QuestionType,
} from "@/lib/validation/evaluation";

import { EvaluationActionsPanel } from "./actions-panel";

// PKWT kesimpulan thresholds (from the paper form): 2 of these 3 must
// be met to recommend permanent conversion.
const PKWT_GOAL_MIN = 95;
const PKWT_MANAJEMEN_MIN = 3.0;
const PKWT_COMPETENCY_MIN = 90;

export const metadata: Metadata = { title: "Evaluation detail" };

const STATUS_TONE: Record<EvaluationStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  SUBMITTED_BY_SPV: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  REVIEWED_BY_PM: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  RETURNED_TO_SPV: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  APPROVED_BY_OM: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  REJECTED_BY_OM: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  FINALIZED: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
};

export default async function EvaluationDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const [employee, t, tDetail, tStatus, tRec] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("performance"),
    getTranslations("performance.detail"),
    getTranslations("performance.status"),
    getTranslations("performance.recommendation"),
  ]);
  const supabase = await createClient();

  const { data: rowRaw } = await supabase
    .from("performance_evaluations")
    .select(
      "*, employee:employee_id(id, full_name, employment_type), template:template_id(id, name), spv:spv_employee_id(id, full_name), pm:pm_employee_id(id, full_name), om:om_employee_id(id, full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!rowRaw) notFound();

  const evalRow = rowRaw as unknown as {
    id: string;
    status: EvaluationStatus;
    contract_end_date: string;
    total_score: string | null;
    spv_recommendation: ContractRecommendation | null;
    spv_notes: string | null;
    pm_notes: string | null;
    om_notes: string | null;
    submitted_at: string | null;
    pm_reviewed_at: string | null;
    om_decided_at: string | null;
    finalized_at: string | null;
    // PKWT meta (migration 0062 + 0063)
    period_start_date: string | null;
    period_end_date: string | null;
    strengths: string | null;
    dev_areas: string | null;
    dev_proposal: string | null;
    goal_achievement_pct: string | number | null;
    competency_meet_pct: string | number | null;
    is_final_period: boolean;
    // Simplified 2-option extension (migration 0065)
    contract_extension_months: number | null;
    contract_extension_end_date: string | null;
    employee: { id: string; full_name: string; employment_type: string };
    template: { id: string; name: string };
    spv: { id: string; full_name: string } | null;
    pm: { id: string; full_name: string } | null;
    om: { id: string; full_name: string } | null;
    spv_employee_id: string;
    pm_employee_id: string | null;
    om_employee_id: string | null;
  };

  // Items + answers.
  const { data: items } = await supabase
    .from("evaluation_template_items")
    .select("id, seq, name, description, weight_pct, question_type, is_required")
    .eq("template_id", evalRow.template.id)
    .order("seq", { ascending: true });
  const { data: answers } = await supabase
    .from("evaluation_answers")
    .select("item_id, numeric_score, text_answer")
    .eq("evaluation_id", evalRow.id);

  const answerByItem = new Map(
    (answers ?? []).map((a) => [a.item_id, a] as const),
  );

  // Compute "rata-rata Manajemen Pekerjaan" — simple mean of numeric
  // scores across all SCORE_1_5 items that actually have a value.
  // The PKWT paper form uses a plain arithmetic mean over the 10
  // aspek, not the weighted total_score. We mirror that so the
  // number matches what the user would compute by hand.
  const scoreItemIds = new Set(
    (items ?? [])
      .filter((it) => it.question_type === "SCORE_1_5")
      .map((it) => it.id),
  );
  const rawScores = (answers ?? [])
    .filter((a) => scoreItemIds.has(a.item_id) && a.numeric_score !== null)
    .map((a) => Number(a.numeric_score));
  const manajemenAvg =
    rawScores.length > 0
      ? rawScores.reduce((s, x) => s + x, 0) / rawScores.length
      : null;

  const goalPct =
    evalRow.goal_achievement_pct === null
      ? null
      : Number(evalRow.goal_achievement_pct);
  const compPct =
    evalRow.competency_meet_pct === null
      ? null
      : Number(evalRow.competency_meet_pct);

  const critGoal =
    goalPct !== null ? goalPct >= PKWT_GOAL_MIN : null;
  const critManajemen =
    manajemenAvg !== null ? manajemenAvg >= PKWT_MANAJEMEN_MIN : null;
  const critCompetency =
    compPct !== null ? compPct >= PKWT_COMPETENCY_MIN : null;
  const metCount =
    (critGoal === true ? 1 : 0) +
    (critManajemen === true ? 1 : 0) +
    (critCompetency === true ? 1 : 0);
  const hasFullData =
    critGoal !== null && critManajemen !== null && critCompetency !== null;

  const canonical = toCanonicalRole(employee.role);
  const isSpv = evalRow.spv_employee_id === employee.id;
  const isPmRow =
    (evalRow.pm_employee_id ?? "") === employee.id ||
    canonical === "PM" ||
    canonical === "OM" ||
    canonical === "ADMIN";
  const isOm =
    canonical === "OM" ||
    canonical === "DIRECTOR" ||
    canonical === "ADMIN" ||
    (evalRow.om_employee_id ?? "") === employee.id;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/hr/performance" />}
        >
          <ArrowLeft className="size-4" />
          {tDetail("back")}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-meta">{tDetail("kicker")}</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {evalRow.employee.full_name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className={STATUS_TONE[evalRow.status]}>
              {tStatus(evalRow.status)}
            </Badge>
            <span>· {evalRow.template.name}</span>
            <span>· contract ends {formatDateOnly(evalRow.contract_end_date)}</span>
            {evalRow.total_score ? (
              <span>· {t("form.totalScore")}: {Number(evalRow.total_score).toFixed(1)}</span>
            ) : null}
          </div>
          {/* Approved extension summary — surfaced right under the
              header once SPV/PM has locked in a duration, so anyone
              opening the eval sees the target contract end date
              without scrolling to the timeline. */}
          {evalRow.contract_extension_months &&
          evalRow.contract_extension_end_date ? (
            <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300">
              <span>{tDetail("extensionBadge")}</span>
              <span className="tabular-nums font-medium">
                +{evalRow.contract_extension_months} bln →{" "}
                <strong>
                  {formatDateOnly(evalRow.contract_extension_end_date)}
                </strong>
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {/* Timeline */}
      <Card className="glass">
        <CardHeader>
          <CardTitle>{tDetail("timeline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-sm grid gap-2">
            <li>
              <span className="font-medium">SPV</span> ·{" "}
              {evalRow.spv?.full_name ?? "—"}
              {evalRow.submitted_at
                ? ` · submitted ${formatDateOnly(evalRow.submitted_at)}`
                : ""}
              {evalRow.spv_recommendation ? (
                <>
                  {" "}
                  · rec:{" "}
                  {tRec(canonicalRecommendation(evalRow.spv_recommendation))}
                  {evalRow.contract_extension_months &&
                  evalRow.contract_extension_end_date ? (
                    <>
                      {" "}
                      (+{evalRow.contract_extension_months} bln →{" "}
                      {formatDateOnly(evalRow.contract_extension_end_date)})
                    </>
                  ) : null}
                </>
              ) : null}
            </li>
            {evalRow.spv_notes ? (
              <li className="text-xs text-muted-foreground pl-4">
                “{evalRow.spv_notes}”
              </li>
            ) : null}
            <li>
              <span className="font-medium">PM</span> ·{" "}
              {evalRow.pm?.full_name ?? "—"}
              {evalRow.pm_reviewed_at
                ? ` · reviewed ${formatDateOnly(evalRow.pm_reviewed_at)}`
                : ""}
            </li>
            {evalRow.pm_notes ? (
              <li className="text-xs text-muted-foreground pl-4">
                “{evalRow.pm_notes}”
              </li>
            ) : null}
            <li>
              <span className="font-medium">OM</span> ·{" "}
              {evalRow.om?.full_name ?? "—"}
              {evalRow.om_decided_at
                ? ` · decided ${formatDateOnly(evalRow.om_decided_at)}`
                : ""}
            </li>
            {evalRow.om_notes ? (
              <li className="text-xs text-muted-foreground pl-4">
                “{evalRow.om_notes}”
              </li>
            ) : null}
          </ol>
        </CardContent>
      </Card>

      {/* Answers */}
      <Card className="glass">
        <CardHeader>
          <CardTitle>{tDetail("answersSection")}</CardTitle>
          <CardDescription>{t("form.totalScore")}:{" "}
            {evalRow.total_score ? Number(evalRow.total_score).toFixed(1) : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {tDetail("answersEmpty")}
            </p>
          ) : (
            <EvaluationActionsPanel
              evaluationId={evalRow.id}
              status={evalRow.status}
              isSpv={isSpv}
              isPm={isPmRow}
              isOm={isOm}
              contractEndDate={evalRow.contract_end_date}
              items={(items ?? []).map((it) => ({
                id: it.id,
                seq: it.seq,
                name: it.name,
                description: it.description,
                weight_pct: Number(it.weight_pct),
                question_type: it.question_type as QuestionType,
                is_required: it.is_required,
              }))}
              answers={Array.from(answerByItem.values()).map((a) => ({
                item_id: a.item_id,
                numeric_score: a.numeric_score,
                text_answer: a.text_answer,
              }))}
              meta={{
                period_start_date: evalRow.period_start_date,
                period_end_date: evalRow.period_end_date,
                strengths: evalRow.strengths,
                dev_areas: evalRow.dev_areas,
                dev_proposal: evalRow.dev_proposal,
                goal_achievement_pct: goalPct,
                competency_meet_pct: compPct,
                is_final_period: evalRow.is_final_period,
                manajemen_avg: manajemenAvg,
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Kesimpulan / Penilaian Akhir — visible when SPV toggles
          `is_final_period`. Shows the 3 PKWT criteria + count met
          + suggested recommendation. Read-only summary; the SPV
          picks the actual recommendation in the panel above. */}
      {evalRow.is_final_period ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle>{tDetail("kesimpulanTitle")}</CardTitle>
            <CardDescription>{tDetail("kesimpulanSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <CriteriaRow
                label={tDetail("critGoal")}
                threshold={`≥ ${PKWT_GOAL_MIN}%`}
                actual={goalPct === null ? "—" : `${goalPct.toFixed(1)}%`}
                met={critGoal}
              />
              <CriteriaRow
                label={tDetail("critManajemen")}
                threshold={`≥ ${PKWT_MANAJEMEN_MIN.toFixed(1)}`}
                actual={
                  manajemenAvg === null ? "—" : manajemenAvg.toFixed(2)
                }
                met={critManajemen}
              />
              <CriteriaRow
                label={tDetail("critCompetency")}
                threshold={`≥ ${PKWT_COMPETENCY_MIN}%`}
                actual={compPct === null ? "—" : `${compPct.toFixed(1)}%`}
                met={critCompetency}
              />
            </div>
            <div className="mt-4 rounded-md border bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {tDetail("kesimpulanMet")}:
                </span>
                <span className="tabular-nums">{metCount} / 3</span>
                {hasFullData ? (
                  metCount >= 2 ? (
                    <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                      {tDetail("kesimpulanRecommendPermanent")}
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">
                      {tDetail("kesimpulanRecommendReview")}
                    </Badge>
                  )
                ) : (
                  <Badge variant="outline">
                    {tDetail("kesimpulanIncomplete")}
                  </Badge>
                )}
              </div>
              {evalRow.spv_recommendation ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {tDetail("kesimpulanCurrentRec")}:{" "}
                  <span className="text-foreground">
                    {tRec(
                      canonicalRecommendation(evalRow.spv_recommendation),
                    )}
                    {evalRow.contract_extension_months &&
                    evalRow.contract_extension_end_date ? (
                      <>
                        {" "}
                        · +{evalRow.contract_extension_months} bln →{" "}
                        <span className="tabular-nums font-medium">
                          {formatDateOnly(
                            evalRow.contract_extension_end_date,
                          )}
                        </span>
                      </>
                    ) : null}
                  </span>
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CriteriaRow({
  label,
  threshold,
  actual,
  met,
}: {
  label: string;
  threshold: string;
  actual: string;
  met: boolean | null;
}) {
  return (
    <div className="rounded-md border p-3 grid gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums">{actual}</span>
        <span className="text-[11px] text-muted-foreground">{threshold}</span>
      </div>
      <div className="flex items-center gap-1 text-xs">
        {met === true ? (
          <>
            <CheckCircle2 className="size-3.5 text-emerald-500" />
            <span className="text-emerald-600">Met</span>
          </>
        ) : met === false ? (
          <>
            <XCircle className="size-3.5 text-rose-500" />
            <span className="text-rose-600">Not met</span>
          </>
        ) : (
          <span className="text-muted-foreground">Belum diisi</span>
        )}
      </div>
    </div>
  );
}
