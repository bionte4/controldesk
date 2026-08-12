"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Info,
  Loader2,
  Save,
  Send,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deriveExtensionMonths,
  type ContractRecommendation,
  type EvaluationStatus,
  type QuestionType,
} from "@/lib/validation/evaluation";

import {
  decideEvaluationByOmAction,
  reviewEvaluationByPmAction,
  submitEvaluationBySpvAction,
  updateEvaluationMetaAction,
  upsertEvaluationAnswerAction,
} from "../actions";

type Item = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  weight_pct: number;
  question_type: QuestionType;
  is_required: boolean;
};
type Answer = {
  item_id: string;
  numeric_score: number | null;
  text_answer: string | null;
};

export type EvaluationMeta = {
  period_start_date: string | null;
  period_end_date: string | null;
  strengths: string | null;
  dev_areas: string | null;
  dev_proposal: string | null;
  goal_achievement_pct: number | null;
  competency_meet_pct: number | null;
  is_final_period: boolean;
  /**
   * Server-computed simple mean of `numeric_score` across all
   * SCORE_1_5 items with a value. Passed in for a live preview
   * of the PKWT "rata-rata Manajemen Pekerjaan" criterion — the
   * SPV can eyeball whether they hit the 3.0 threshold before
   * flipping the final-period toggle.
   */
  manajemen_avg: number | null;
};

const RATING_LEGEND = [
  { v: 5, label: "Secara konsisten melampaui standar" },
  { v: 4, label: "Signifikan melebihi standar" },
  { v: 3, label: "Memenuhi standar" },
  { v: 2, label: "Kurang dari standar" },
  { v: 1, label: "Sama sekali tidak memenuhi standar" },
];

export function EvaluationActionsPanel({
  evaluationId,
  status,
  isSpv,
  isPm,
  isOm,
  items,
  answers,
  meta,
  contractEndDate,
}: {
  evaluationId: string;
  status: EvaluationStatus;
  isSpv: boolean;
  isPm: boolean;
  isOm: boolean;
  items: Item[];
  answers: Answer[];
  meta: EvaluationMeta;
  /**
   * Current contract end date at the time this evaluation was created.
   * Used to preview the new end date when SPV picks a duration.
   */
  contractEndDate: string;
}) {
  const t = useTranslations("performance.form");
  const router = useRouter();

  const [state, setState] = React.useState<Record<string, Answer>>(() => {
    const m: Record<string, Answer> = {};
    for (const it of items) {
      const a = answers.find((x) => x.item_id === it.id);
      m[it.id] = {
        item_id: it.id,
        numeric_score: a?.numeric_score ?? null,
        text_answer: a?.text_answer ?? null,
      };
    }
    return m;
  });

  const editableForSpv =
    isSpv && (status === "DRAFT" || status === "RETURNED_TO_SPV");

  const [recommendation, setRecommendation] =
    React.useState<ContractRecommendation | "">("");
  const [extensionEndDate, setExtensionEndDate] = React.useState<string>("");
  const [spvNotes, setSpvNotes] = React.useState("");
  const [pmDecision, setPmDecision] = React.useState<"APPROVE" | "RETURN">(
    "APPROVE",
  );
  const [pmNotes, setPmNotes] = React.useState("");
  const [omDecision, setOmDecision] = React.useState<"APPROVE" | "REJECT">(
    "APPROVE",
  );
  const [omNotes, setOmNotes] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  async function saveAnswer(itemId: string) {
    const a = state[itemId];
    if (!a) return;
    const res = await upsertEvaluationAnswerAction({
      evaluation_id: evaluationId,
      item_id: itemId,
      numeric_score: a.numeric_score ?? null,
      text_answer: a.text_answer ?? null,
    });
    if (!res.ok) toast.error(res.reason ?? "Save failed.");
  }

  // The <input type="date"> `min` — the day AFTER the current contract
  // end date. HTML dates are YYYY-MM-DD so simple string arithmetic
  // won't work; we advance by one calendar day via Date + UTC noon
  // anchor to avoid DST surprises.
  const minExtensionDate = React.useMemo(() => {
    const base = new Date(contractEndDate);
    const nextDay = new Date(
      Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate() + 1,
        12,
        0,
        0,
      ),
    );
    return nextDay.toISOString().slice(0, 10);
  }, [contractEndDate]);

  // Best-effort display "+N bln" derived from the SPV-entered date so
  // reviewers get a quick sense of the extension length without
  // needing a calculator. Falls back to `null` when the date is
  // missing / invalid — the preview banner handles that gracefully.
  const previewMonths = React.useMemo(
    () =>
      recommendation === "EXTEND"
        ? deriveExtensionMonths(contractEndDate, extensionEndDate)
        : null,
    [recommendation, contractEndDate, extensionEndDate],
  );

  const extensionDateIsValid =
    recommendation !== "EXTEND" ||
    (extensionEndDate.length > 0 && extensionEndDate > contractEndDate);

  function onSubmitSpv() {
    if (!recommendation) {
      toast.error("Pilih rekomendasi kontrak.");
      return;
    }
    if (recommendation === "EXTEND" && !extensionEndDate) {
      toast.error("Isi tanggal akhir kontrak baru.");
      return;
    }
    if (
      recommendation === "EXTEND" &&
      extensionEndDate <= contractEndDate
    ) {
      toast.error(
        "Tanggal akhir kontrak baru harus setelah tanggal akhir kontrak sekarang.",
      );
      return;
    }
    startTransition(async () => {
      const res = await submitEvaluationBySpvAction({
        id: evaluationId,
        spv_recommendation: recommendation as ContractRecommendation,
        contract_extension_end_date:
          recommendation === "EXTEND" ? extensionEndDate : null,
        spv_notes: spvNotes || undefined,
      });
      if (res.ok) {
        toast.success("Terkirim untuk review PM.");
        router.refresh();
      } else {
        toast.error(res.reason ?? "Submit failed.");
      }
    });
  }

  function onPmDecide() {
    if (pmDecision === "RETURN" && !pmNotes) {
      toast.error("Coaching notes are required when returning.");
      return;
    }
    startTransition(async () => {
      const res = await reviewEvaluationByPmAction({
        id: evaluationId,
        decision: pmDecision,
        pm_notes: pmNotes || undefined,
      });
      if (res.ok) {
        toast.success(
          pmDecision === "APPROVE"
            ? "Diteruskan ke OM."
            : "Dikembalikan ke SPV untuk coaching.",
        );
        router.refresh();
      } else {
        toast.error(res.reason ?? "Action failed.");
      }
    });
  }

  function onOmDecide() {
    if (omDecision === "REJECT" && !omNotes) {
      toast.error("Notes are required when rejecting.");
      return;
    }
    startTransition(async () => {
      const res = await decideEvaluationByOmAction({
        id: evaluationId,
        decision: omDecision,
        om_notes: omNotes || undefined,
      });
      if (res.ok) {
        toast.success(
          omDecision === "APPROVE"
            ? "Evaluation finalized."
            : "Evaluation rejected.",
        );
        router.refresh();
      } else {
        toast.error(res.reason ?? "Action failed.");
      }
    });
  }

  return (
    <div className="grid gap-4">
      {/* Rating scale legend — always visible so reviewers understand
          what a "3" or "4" actually means (per PKWT form). */}
      <div className="rounded-lg border bg-muted/20 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium">
          <Info className="size-4" />
          <span>{t("ratingScale")}</span>
        </div>
        <div className="mt-2 grid gap-1 sm:grid-cols-5">
          {RATING_LEGEND.map((r) => (
            <div key={r.v} className="flex items-start gap-1.5">
              <span className="inline-flex size-5 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-medium">
                {r.v}
              </span>
              <span className="text-muted-foreground leading-tight">
                {r.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Meta section — evaluation period + PKWT narratives + external
          goal/competency percentages. SPV-editable only while DRAFT or
          RETURNED_TO_SPV. */}
      <EvaluationMetaSection
        evaluationId={evaluationId}
        meta={meta}
        editable={editableForSpv}
      />

      {/* Items */}
      <div className="grid gap-3">
        {items.map((it) => {
          const a =
            state[it.id] ??
            ({
              item_id: it.id,
              numeric_score: null,
              text_answer: null,
            } as Answer);
          return (
            <div key={it.id} className="rounded-lg border p-3 grid gap-2">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="tabular-nums text-muted-foreground text-xs">
                  #{it.seq}
                </span>
                <span className="font-medium">{it.name}</span>
                <span className="text-xs text-muted-foreground">
                  · {it.weight_pct}%
                </span>
                {it.is_required ? (
                  <span className="text-xs text-rose-500" aria-label="required">
                    *
                  </span>
                ) : null}
              </div>
              {it.description ? (
                <p className="text-xs text-muted-foreground -mt-1">
                  {it.description}
                </p>
              ) : null}

              {it.question_type === "SCORE_1_5" ? (
                <div className="grid gap-2 md:grid-cols-[140px_1fr] items-start">
                  <Select
                    value={a.numeric_score ? String(a.numeric_score) : ""}
                    onValueChange={(v) => {
                      const next = v ? Number(v) : null;
                      setState((s) => ({
                        ...s,
                        [it.id]: { ...a, numeric_score: next },
                      }));
                    }}
                    disabled={!editableForSpv}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("answerScorePlaceholder")} />
                    </SelectTrigger>
                    {/*
                      Popup is wider than the 140px trigger so the full
                      rating description (e.g. "Sama sekali tidak
                      memenuhi standar") stays readable. Without this
                      the item text got truncated and overlapped with
                      the sibling comment textarea.
                    */}
                    <SelectContent className="min-w-[320px]">
                      {RATING_LEGEND.slice()
                        .reverse()
                        .map((r) => (
                          <SelectItem key={r.v} value={String(r.v)}>
                            {r.v} — {r.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    rows={2}
                    value={a.text_answer ?? ""}
                    disabled={!editableForSpv}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        [it.id]: { ...a, text_answer: e.target.value },
                      }))
                    }
                    onBlur={() => {
                      if (editableForSpv) saveAnswer(it.id);
                    }}
                    placeholder={t("commentPlaceholder")}
                  />
                </div>
              ) : (
                <Textarea
                  rows={3}
                  value={a.text_answer ?? ""}
                  disabled={!editableForSpv}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      [it.id]: { ...a, text_answer: e.target.value },
                    }))
                  }
                  onBlur={() => {
                    if (editableForSpv) saveAnswer(it.id);
                  }}
                  placeholder={t("answerTextPlaceholder")}
                />
              )}

              {editableForSpv ? (
                <div className="pt-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => saveAnswer(it.id)}
                  >
                    <Save className="size-3.5" />
                    {t("saveItem")}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* SPV submit */}
      {isSpv && (status === "DRAFT" || status === "RETURNED_TO_SPV") ? (
        <div className="rounded-lg border p-3 grid gap-3">
          <label className="text-sm font-medium">
            {t("spvRecommendation")}
          </label>
          {/*
            Simplified 2-option recommendation (0065 + 0065-manual). If
            SPV picks "Diperpanjang" a manual date input appears next
            to it. `min` on the input is the day after the current
            contract end so the browser blocks obvious footguns; the
            server re-validates the constraint too.
          */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">
                {t("recommendationLabel")}
              </label>
              <Select
                value={recommendation}
                onValueChange={(v) => {
                  const next = (v ?? "") as ContractRecommendation | "";
                  setRecommendation(next);
                  // Clear the extension date whenever the
                  // recommendation switches away from EXTEND —
                  // otherwise a stale date leaks into a "Not extend"
                  // submit.
                  if (next !== "EXTEND") setExtensionEndDate("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("recommendationPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXTEND">{t("recExtend")}</SelectItem>
                  <SelectItem value="NOT_EXTEND">
                    {t("recNotExtend")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {recommendation === "EXTEND" ? (
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">
                  {t("extensionEndDateLabel")}
                </label>
                <Input
                  type="date"
                  min={minExtensionDate}
                  value={extensionEndDate}
                  onChange={(e) => setExtensionEndDate(e.target.value)}
                  aria-invalid={!extensionDateIsValid}
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("extensionEndDateHint", {
                    currentEnd: contractEndDate,
                  })}
                </p>
              </div>
            ) : null}
          </div>

          {/* Live preview — SPV-entered date + best-effort "+N bln"
              summary so reviewers get a quick sense of the extension
              length without needing a calculator. Only visible when
              the date passes the `> contract_end_date` guard. */}
          {recommendation === "EXTEND" && extensionDateIsValid && extensionEndDate ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2.5 text-xs text-emerald-700 dark:text-emerald-300 flex flex-wrap items-center justify-between gap-2">
              <span>{t("extensionPreviewLabel")}</span>
              <span className="tabular-nums font-medium">
                <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                  {contractEndDate}
                </span>{" "}
                → <strong>{extensionEndDate}</strong>
                {previewMonths !== null ? (
                  <span className="ml-1 text-muted-foreground">
                    (≈ {previewMonths} bln)
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}
          {recommendation === "EXTEND" &&
          extensionEndDate.length > 0 &&
          !extensionDateIsValid ? (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-2.5 text-xs text-rose-700 dark:text-rose-300">
              {t("extensionDateAfterCurrent", {
                currentEnd: contractEndDate,
              })}
            </div>
          ) : null}
          {recommendation === "NOT_EXTEND" ? (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-700 dark:text-rose-300">
              {t("notExtendHint")}
            </div>
          ) : null}

          <label className="text-sm font-medium mt-1">{t("spvNotes")}</label>
          <Textarea
            rows={3}
            value={spvNotes}
            onChange={(e) => setSpvNotes(e.target.value)}
            placeholder={t("spvNotesPlaceholder")}
          />
          <div className="flex justify-end pt-1">
            <Button
              onClick={onSubmitSpv}
              disabled={
                pending ||
                !recommendation ||
                (recommendation === "EXTEND" && !extensionDateIsValid)
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {t("submit")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* PM review */}
      {isPm && status === "SUBMITTED_BY_SPV" ? (
        <div className="rounded-lg border p-3 grid gap-2">
          <label className="text-sm font-medium">{t("pmDecision")}</label>
          <div className="flex gap-2">
            <Button
              variant={pmDecision === "APPROVE" ? "default" : "outline"}
              size="sm"
              onClick={() => setPmDecision("APPROVE")}
            >
              <CheckCircle2 className="size-4" />
              {t("pmApprove")}
            </Button>
            <Button
              variant={pmDecision === "RETURN" ? "default" : "outline"}
              size="sm"
              onClick={() => setPmDecision("RETURN")}
            >
              <Undo2 className="size-4" />
              {t("pmReturn")}
            </Button>
          </div>
          <label className="text-sm font-medium mt-2">{t("pmNotes")}</label>
          <Textarea
            rows={3}
            value={pmNotes}
            onChange={(e) => setPmNotes(e.target.value)}
          />
          <div className="flex justify-end pt-1">
            <Button onClick={onPmDecide} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm
            </Button>
          </div>
        </div>
      ) : null}

      {/* OM decision */}
      {isOm && status === "REVIEWED_BY_PM" ? (
        <div className="rounded-lg border p-3 grid gap-2">
          <label className="text-sm font-medium">{t("omDecision")}</label>
          <div className="flex gap-2">
            <Button
              variant={omDecision === "APPROVE" ? "default" : "outline"}
              size="sm"
              onClick={() => setOmDecision("APPROVE")}
            >
              <CheckCircle2 className="size-4" />
              {t("omApprove")}
            </Button>
            <Button
              variant={omDecision === "REJECT" ? "default" : "outline"}
              size="sm"
              onClick={() => setOmDecision("REJECT")}
            >
              <XCircle className="size-4" />
              {t("omReject")}
            </Button>
          </div>
          <label className="text-sm font-medium mt-2">{t("omNotes")}</label>
          <Textarea
            rows={3}
            value={omNotes}
            onChange={(e) => setOmNotes(e.target.value)}
          />
          <div className="flex justify-end pt-1">
            <Button onClick={onOmDecide} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// Meta section — evaluation period + PKWT narratives + goal / competency
// percentages. Kept in-file because it's tightly coupled with the parent
// (uses the same wire types + action). Broken out to a subcomponent to
// avoid one giant render function.
// ---------------------------------------------------------------------
function EvaluationMetaSection({
  evaluationId,
  meta,
  editable,
}: {
  evaluationId: string;
  meta: EvaluationMeta;
  editable: boolean;
}) {
  const t = useTranslations("performance.form");
  const router = useRouter();
  const [state, setState] = React.useState({
    period_start_date: meta.period_start_date ?? "",
    period_end_date: meta.period_end_date ?? "",
    strengths: meta.strengths ?? "",
    dev_areas: meta.dev_areas ?? "",
    dev_proposal: meta.dev_proposal ?? "",
    goal_achievement_pct:
      meta.goal_achievement_pct !== null ? String(meta.goal_achievement_pct) : "",
    competency_meet_pct:
      meta.competency_meet_pct !== null ? String(meta.competency_meet_pct) : "",
    is_final_period: meta.is_final_period,
  });
  const [pending, startTransition] = React.useTransition();

  function save() {
    startTransition(async () => {
      const goalPct = state.goal_achievement_pct.trim()
        ? Number(state.goal_achievement_pct)
        : null;
      const compPct = state.competency_meet_pct.trim()
        ? Number(state.competency_meet_pct)
        : null;
      if (
        (goalPct !== null && (Number.isNaN(goalPct) || goalPct < 0 || goalPct > 100)) ||
        (compPct !== null && (Number.isNaN(compPct) || compPct < 0 || compPct > 100))
      ) {
        toast.error("Persentase harus 0-100.");
        return;
      }
      const res = await updateEvaluationMetaAction({
        id: evaluationId,
        period_start_date: state.period_start_date || null,
        period_end_date: state.period_end_date || null,
        strengths: state.strengths || null,
        dev_areas: state.dev_areas || null,
        dev_proposal: state.dev_proposal || null,
        goal_achievement_pct: goalPct,
        competency_meet_pct: compPct,
        is_final_period: state.is_final_period,
      });
      if (res.ok) {
        toast.success(t("metaSaved"));
        router.refresh();
      } else {
        toast.error(res.reason ?? "Save failed.");
      }
    });
  }

  return (
    <div className="rounded-lg border p-3 grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{t("metaTitle")}</div>
        {/*
          "Periode Penilaian Akhir" toggle — flip ON when this is the
          last quarterly eval before the PKWT decision. Turning it on
          reveals the 3-opsi kesimpulan dropdown + criteria card
          downstream. Kept as a checkbox rather than a radio so the
          SPV can still uncheck if they realize the contract has
          another quarter left.
        */}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={state.is_final_period}
            disabled={!editable}
            onChange={(e) =>
              setState((s) => ({ ...s, is_final_period: e.target.checked }))
            }
          />
          <span
            className={
              state.is_final_period
                ? "font-medium text-primary"
                : "text-muted-foreground"
            }
          >
            {t("finalPeriodToggle")}
          </span>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">
            {t("periodStart")}
          </label>
          <Input
            type="date"
            value={state.period_start_date}
            disabled={!editable}
            onChange={(e) =>
              setState((s) => ({ ...s, period_start_date: e.target.value }))
            }
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">
            {t("periodEnd")}
          </label>
          <Input
            type="date"
            value={state.period_end_date}
            disabled={!editable}
            onChange={(e) =>
              setState((s) => ({ ...s, period_end_date: e.target.value }))
            }
          />
        </div>
      </div>

      {/* Live preview — the current computed "rata-rata Manajemen
          Pekerjaan" (mean of all SCORE_1_5 answers). Kept lightweight
          because the full kesimpulan lives in the page's dedicated
          card. */}
      {meta.manajemen_avg !== null ? (
        <div className="rounded-md border bg-muted/20 p-2 text-xs flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {t("manajemenAvgLabel")}
          </span>
          <span className="tabular-nums font-medium">
            {meta.manajemen_avg.toFixed(2)}{" "}
            <span className="text-muted-foreground">/ 5.00</span>
          </span>
        </div>
      ) : null}

      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">
          {t("strengths")}
        </label>
        <Textarea
          rows={2}
          value={state.strengths}
          disabled={!editable}
          onChange={(e) =>
            setState((s) => ({ ...s, strengths: e.target.value }))
          }
          placeholder={t("strengthsPlaceholder")}
          maxLength={4000}
        />
      </div>

      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">
          {t("devAreas")}
        </label>
        <Textarea
          rows={2}
          value={state.dev_areas}
          disabled={!editable}
          onChange={(e) =>
            setState((s) => ({ ...s, dev_areas: e.target.value }))
          }
          placeholder={t("devAreasPlaceholder")}
          maxLength={4000}
        />
      </div>

      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">
          {t("devProposal")}
        </label>
        <Textarea
          rows={2}
          value={state.dev_proposal}
          disabled={!editable}
          onChange={(e) =>
            setState((s) => ({ ...s, dev_proposal: e.target.value }))
          }
          placeholder={t("devProposalPlaceholder")}
          maxLength={4000}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">
            {t("goalAchievement")}
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={state.goal_achievement_pct}
            disabled={!editable}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                goal_achievement_pct: e.target.value,
              }))
            }
            placeholder="0-100"
            className="tabular-nums"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">
            {t("competencyMeet")}
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={state.competency_meet_pct}
            disabled={!editable}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                competency_meet_pct: e.target.value,
              }))
            }
            placeholder="0-100"
            className="tabular-nums"
          />
        </div>
      </div>

      {editable ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {t("metaSave")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
