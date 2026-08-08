"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectStatus } from "@/types/database";

import {
  activateProjectAction,
  promoteProjectFromBusinessCaseAction,
} from "../actions";

export type PmPickOption = { id: string; name: string; role?: string };

/**
 * Lifecycle banner for the project detail page. Renders three-stage
 * progress + the CTA appropriate for the current stage:
 *
 *   DRAFT     → "Promote to Planning"          (needs BC filled)
 *   PLANNING  → "Activate & Assign PM"         (needs APPROVED budget)
 *   ACTIVE    → All good — hides the CTA
 *
 * The banner also warns when the project is locked for operations so
 * requesters know why their expense/CA is refused. Only shown to
 * users who can manage the lifecycle (OM / ADMIN); everybody else
 * sees the current-stage indicator without the CTA buttons.
 */
export function ProjectLifecycleBanner({
  projectId,
  status,
  hasApprovedBudget,
  hasActivePm,
  hasBcMinimum,
  canManageLifecycle,
  pmOptions,
}: {
  projectId: string;
  status: ProjectStatus;
  hasApprovedBudget: boolean;
  hasActivePm: boolean;
  /** BC minimum = executive_summary + sponsor filled. */
  hasBcMinimum: boolean;
  canManageLifecycle: boolean;
  pmOptions: PmPickOption[];
}) {
  const t = useTranslations("projects.lifecycle");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [activateOpen, setActivateOpen] = React.useState(false);
  const [pickedPm, setPickedPm] = React.useState<string>("");

  // Post-terminal statuses collapse into a single "closed" state on
  // the banner; the CTA lane hides entirely. Everything else maps to
  // one of the three progress dots.
  const isClosed =
    status === "COMPLETED" || status === "ARCHIVED" || status === "ON_HOLD";
  const stageIdx: 0 | 1 | 2 =
    status === "DRAFT" ? 0 : status === "PLANNING" ? 1 : 2;

  const stages: Array<{ key: "draft" | "planning" | "active"; label: string }> = [
    { key: "draft", label: t("stageDraft") },
    { key: "planning", label: t("stagePlanning") },
    { key: "active", label: t("stageActive") },
  ];

  function onPromote() {
    startTransition(async () => {
      const res = await promoteProjectFromBusinessCaseAction({ id: projectId });
      if (res.ok) {
        toast.success(t("toastPromoted"));
        router.refresh();
      } else {
        toast.error(res.reason ?? t("toastPromoteFailed"));
      }
    });
  }

  function onActivate() {
    if (!pickedPm) {
      toast.error(t("activatePickPmError"));
      return;
    }
    startTransition(async () => {
      const res = await activateProjectAction({
        id: projectId,
        pm_employee_id: pickedPm,
      });
      if (res.ok) {
        toast.success(t("toastActivated"));
        setActivateOpen(false);
        router.refresh();
      } else {
        toast.error(res.reason ?? t("toastActivateFailed"));
      }
    });
  }

  return (
    <div
      className={`rounded-xl border p-3 md:p-4 ${
        isClosed
          ? "border-border/60 bg-muted/30"
          : stageIdx === 2
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-amber-500/40 bg-amber-500/5"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Left: 3-stage indicator */}
        <div className="flex items-center gap-2 min-w-0">
          {stages.map((s, i) => {
            const done = i < stageIdx || (i === 2 && stageIdx === 2 && !isClosed);
            const current = i === stageIdx && !isClosed;
            return (
              <React.Fragment key={s.key}>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    done
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : current
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : current ? (
                    <span className="size-2 rounded-full bg-amber-500" />
                  ) : (
                    <span className="size-2 rounded-full bg-muted-foreground/40" />
                  )}
                  {s.label}
                </span>
                {i < stages.length - 1 ? (
                  <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                ) : null}
              </React.Fragment>
            );
          })}
        </div>

        {/* Middle: gate / status blurb */}
        <div className="flex-1 min-w-0 text-sm text-muted-foreground">
          {isClosed ? (
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5" />
              {t(`closedHint_${status}`)}
            </span>
          ) : status === "DRAFT" ? (
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="size-3.5" />
              {hasBcMinimum ? t("draftReady") : t("draftMissingBc")}
            </span>
          ) : status === "PLANNING" ? (
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="size-3.5" />
              {!hasApprovedBudget
                ? t("planningMissingBudget")
                : t("planningReady")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              {t("activeReady")}
            </span>
          )}
        </div>

        {/* Right: CTA lane */}
        {canManageLifecycle && !isClosed ? (
          <div className="flex items-center gap-2">
            {status === "DRAFT" ? (
              <Button
                size="sm"
                onClick={onPromote}
                disabled={!hasBcMinimum || isPending}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t("ctaPromote")}
              </Button>
            ) : null}
            {status === "PLANNING" ? (
              <Sheet open={activateOpen} onOpenChange={setActivateOpen}>
                <SheetTrigger
                  render={
                    <Button
                      size="sm"
                      disabled={!hasApprovedBudget}
                      title={
                        !hasApprovedBudget
                          ? t("planningMissingBudget")
                          : undefined
                      }
                    >
                      {t("ctaActivate")}
                    </Button>
                  }
                />
                <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl">
                  <SheetHeader>
                    <SheetTitle>{t("activateTitle")}</SheetTitle>
                    <SheetDescription>{t("activateDescription")}</SheetDescription>
                  </SheetHeader>
                  <div className="flex flex-col gap-3 py-3">
                    <label className="text-sm font-medium">
                      {t("activatePickPm")}
                    </label>
                    <Select
                      value={pickedPm}
                      onValueChange={(v) => setPickedPm(v ?? "")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("activatePickPmPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {pmOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                            {p.role ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {p.role}
                              </span>
                            ) : null}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {hasActivePm ? (
                      <p className="text-[11px] text-muted-foreground">
                        {t("activateHasActivePmHint")}
                      </p>
                    ) : null}
                  </div>
                  <SheetFooter className="flex-row justify-end gap-2">
                    <SheetClose
                      render={
                        <Button variant="ghost" disabled={isPending}>
                          {tCommon("cancel")}
                        </Button>
                      }
                    />
                    <Button
                      onClick={onActivate}
                      disabled={isPending || !pickedPm}
                    >
                      {isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      {t("ctaActivate")}
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
