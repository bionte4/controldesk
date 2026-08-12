"use client";

/**
 * ControlDesk — Admin surface for per-tenant approval thresholds
 * (Option B, rules §9). Shows one editable card per `ApprovalKind`
 * with the fields that kind actually uses (Petty Cash has different
 * knobs than Expense, etc.). Every field displays the global default
 * next to it as placeholder so admins know the fallback value that
 * kicks in when they leave the field empty.
 *
 * The UI intentionally avoids react-hook-form here — the schema is
 * flat, each kind is independent, and the "reset to default" button
 * uses a separate action, so per-card useState is enough and keeps
 * the file self-contained.
 */

import * as React from "react";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw, Save, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import {
  resetApprovalThresholdAction,
  upsertApprovalThresholdAction,
} from "./actions";
import {
  APPROVAL_DEFAULTS,
  type ApprovalThresholdRow,
} from "@/lib/data/approval-thresholds-defaults";
import type { ApprovalKind } from "@/lib/validation/approval-thresholds";

type Overrides = Partial<Record<ApprovalKind, ApprovalThresholdRow>>;

type FieldKey =
  | "supervisor_threshold"
  | "pm_threshold"
  | "om_threshold"
  | "director_threshold"
  | "petty_auto_approve_below"
  | "petty_receipt_required_above"
  | "petty_hard_ceiling"
  | "settlement_sla_days";

/**
 * Which fields each kind actually uses. Everything else is greyed out /
 * absent from the form so admins can't accidentally set a Supervisor
 * threshold on Expense (which has no Supervisor slot).
 */
const FIELDS_BY_KIND: Record<ApprovalKind, FieldKey[]> = {
  EXPENSE: ["pm_threshold", "director_threshold"],
  BUDGET: ["director_threshold"],
  CASH_ADVANCE_GENERAL: ["pm_threshold", "director_threshold"],
  CASH_ADVANCE_FIELD_OPS: [
    "pm_threshold",
    "om_threshold",
    "director_threshold",
    "settlement_sla_days",
  ],
  PETTY_CASH: [
    "petty_auto_approve_below",
    "petty_receipt_required_above",
    "petty_hard_ceiling",
  ],
  BUDGET_REQUEST: ["pm_threshold", "director_threshold"],
};

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

const KIND_ORDER: readonly ApprovalKind[] = [
  "EXPENSE",
  "BUDGET",
  "CASH_ADVANCE_GENERAL",
  "CASH_ADVANCE_FIELD_OPS",
  "BUDGET_REQUEST",
  "PETTY_CASH",
];

export function ThresholdManager({ overrides }: { overrides: Overrides }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {KIND_ORDER.map((kind) => (
        <ThresholdCard
          key={kind}
          kind={kind}
          override={overrides[kind] ?? null}
        />
      ))}
    </div>
  );
}

function ThresholdCard({
  kind,
  override,
}: {
  kind: ApprovalKind;
  override: ApprovalThresholdRow | null;
}) {
  const t = useTranslations("settings.approvalThresholds");
  const tKind = useTranslations("settings.approvalThresholds.kinds");
  const [pending, startTransition] = useTransition();
  const [resetPending, startResetTransition] = useTransition();

  const defaults = APPROVAL_DEFAULTS[kind];
  const fields = FIELDS_BY_KIND[kind];

  // Local form state — one string per field so a blank input maps to
  // "clear override" via the Zod transform. We seed from override or
  // fall back to empty (placeholder shows the default).
  const [values, setValues] = React.useState<Record<FieldKey, string>>(() => {
    const seed: Record<FieldKey, string> = {
      supervisor_threshold: "",
      pm_threshold: "",
      om_threshold: "",
      director_threshold: "",
      petty_auto_approve_below: "",
      petty_receipt_required_above: "",
      petty_hard_ceiling: "",
      settlement_sla_days: "",
    };
    if (override) {
      for (const f of fields) {
        const v = override[f];
        if (typeof v === "number") seed[f] = String(v);
      }
    }
    return seed;
  });

  const isDirty = React.useMemo(() => {
    if (!override) {
      return fields.some((f) => values[f] !== "");
    }
    return fields.some((f) => {
      const cur = override[f];
      const nextRaw = values[f];
      if (nextRaw === "") return cur !== null;
      const n = Number(nextRaw);
      return !Number.isFinite(n) || n !== cur;
    });
  }, [values, override, fields]);

  const handleSave = () => {
    startTransition(async () => {
      const payload: Record<string, unknown> = { kind };
      for (const f of fields) {
        // Empty string → clear override (Zod transform → null).
        payload[f] = values[f] === "" ? null : Number(values[f]);
      }
      const result = await upsertApprovalThresholdAction(payload);
      if (result.ok) {
        toast.success(t("toasts.saved", { kind: tKind(kind) }));
      } else {
        toast.error(result.reason ?? t("toasts.saveFailed"));
      }
    });
  };

  const handleReset = () => {
    startResetTransition(async () => {
      const result = await resetApprovalThresholdAction({ kind });
      if (result.ok) {
        // Clear local state so the UI reflects the DB immediately —
        // revalidatePath will refetch on next navigation anyway.
        setValues((prev) => {
          const cleared = { ...prev };
          for (const f of fields) cleared[f] = "";
          return cleared;
        });
        toast.success(t("toasts.reset", { kind: tKind(kind) }));
      } else {
        toast.error(result.reason ?? t("toasts.resetFailed"));
      }
    });
  };

  return (
    <Card className={cn("glass", override ? "border-amber-400/40" : "")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{tKind(kind)}</CardTitle>
            <CardDescription>{t(`descriptions.${kind}`)}</CardDescription>
          </div>
          {override ? (
            <Badge
              variant="outline"
              className="border-amber-400/30 bg-amber-500/10 text-amber-300"
            >
              {t("customBadge")}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t("defaultBadge")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            const defaultValue = defaults[f];
            const placeholder =
              defaultValue == null
                ? t("noDefault")
                : f === "settlement_sla_days"
                  ? String(defaultValue)
                  : String(defaultValue);
            return (
              <div key={f} className="flex flex-col gap-1.5">
                <Label htmlFor={`${kind}-${f}`} className="text-xs">
                  {t(`fields.${f}`)}
                </Label>
                <Input
                  id={`${kind}-${f}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={f === "settlement_sla_days" ? 1 : 1000}
                  placeholder={placeholder}
                  value={values[f]}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [f]: e.target.value,
                    }))
                  }
                  className="text-sm tabular-nums"
                />
                {defaultValue != null ? (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <ChevronRight className="size-3" aria-hidden />
                    {f === "settlement_sla_days"
                      ? t("defaultSlaDays", { days: defaultValue })
                      : t("defaultIdr", { value: idr(defaultValue) })}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {override?.updated_at
              ? t("updatedAt", {
                  when: new Date(override.updated_at).toLocaleString("id-ID"),
                })
              : t("neverEdited")}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={resetPending || pending || !override}
              aria-label={t("actions.resetAria", { kind: tKind(kind) })}
            >
              <RotateCcw className="mr-1 size-3.5" aria-hidden />
              {t("actions.reset")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={pending || resetPending || !isDirty}
              aria-label={t("actions.saveAria", { kind: tKind(kind) })}
            >
              <Save className="mr-1 size-3.5" aria-hidden />
              {t("actions.save")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
