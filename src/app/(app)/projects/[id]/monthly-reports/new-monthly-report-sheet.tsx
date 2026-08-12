"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

import { createMonthlyReportAction } from "./actions";

/**
 * Start a new monthly report. Auto-defaults to the previous full
 * calendar month — that's the most common workflow: on the 1st,
 * SPV files last month's report.
 */
export function NewMonthlyReportSheet({ projectId }: { projectId: string }) {
  const t = useTranslations("monthlyReport");
  const tForm = useTranslations("monthlyReport.form");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const defaultMonth = React.useMemo(() => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth(); // last full month = current-1 (0-indexed math handles Jan)
    const target = new Date(Date.UTC(y, m - 1, 1));
    return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
  }, []);

  const [open, setOpen] = React.useState(false);
  const [period, setPeriod] = React.useState(defaultMonth);
  const [pending, startTransition] = React.useTransition();

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) setPeriod(defaultMonth);
    },
    [defaultMonth],
  );

  function onSubmit() {
    startTransition(async () => {
      const res = await createMonthlyReportAction({
        project_id: projectId,
        period_month: period,
      });
      if (res.ok) {
        toast.success(t("newReport"));
        setOpen(false);
        router.push(`/projects/${projectId}/monthly-reports/${res.data.id}`);
      } else {
        toast.error(res.reason ?? "Failed to create report.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button>
            <Plus className="size-4" />
            {t("newReport")}
          </Button>
        }
      />
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{t("newReport")}</SheetTitle>
          <SheetDescription>{tForm("periodHint")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 py-3">
          <label className="text-sm font-medium">{tForm("period")}</label>
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            required
          />
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <SheetClose
            render={
              <Button variant="ghost" disabled={pending}>
                {tCommon("cancel")}
              </Button>
            }
          />
          <Button onClick={onSubmit} disabled={pending || !period}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {tCommon("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
