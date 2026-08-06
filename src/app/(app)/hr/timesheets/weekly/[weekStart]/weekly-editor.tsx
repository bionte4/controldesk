"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { submitWeeklyTimesheetAction } from "../actions";

type ProjectOption = { value: string; label: string };

type DayDefault = {
  work_date: string;
  project_id: string | null;
  hours_worked: number;
  hours_overtime: number;
  notes: string | null;
};

type FormValues = {
  days: {
    work_date: string;
    project_id: string;
    hours_worked: number;
    hours_overtime: number;
    notes: string;
  }[];
  notes: string;
};

const UNASSIGNED = "__unassigned__" as const;

export function WeeklyTimesheetEditor({
  employeeId,
  weekStartDate,
  existingNotes,
  days,
  projects,
}: {
  employeeId: string;
  weekStartDate: string;
  existingNotes: string;
  days: DayDefault[];
  projects: ProjectOption[];
}) {
  const t = useTranslations("timesheets.weekly");
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  const { register, handleSubmit, setValue, watch } = useForm<FormValues>({
    defaultValues: {
      notes: existingNotes,
      days: days.map((d) => ({
        work_date: d.work_date,
        project_id: d.project_id ?? UNASSIGNED,
        hours_worked: d.hours_worked,
        hours_overtime: d.hours_overtime,
        notes: d.notes ?? "",
      })),
    },
  });

  const watchedDays = watch("days");
  const totals = React.useMemo(() => {
    let hours = 0;
    let ot = 0;
    for (const d of watchedDays) {
      hours += Number(d.hours_worked) || 0;
      ot += Number(d.hours_overtime) || 0;
    }
    return { hours: Number(hours.toFixed(2)), ot: Number(ot.toFixed(2)) };
  }, [watchedDays]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const payload = {
        employee_id: employeeId,
        week_start_date: weekStartDate,
        notes: values.notes || null,
        days: values.days.map((d) => ({
          work_date: d.work_date,
          project_id: d.project_id === UNASSIGNED ? null : d.project_id,
          hours_worked: Number(d.hours_worked) || 0,
          hours_overtime: Number(d.hours_overtime) || 0,
          notes: d.notes || null,
        })),
      };
      const res = await submitWeeklyTimesheetAction(payload);
      if (res.ok) {
        toast.success(t("editor.submittedToast"));
        router.refresh();
      } else {
        toast.error(res.reason ?? t("editor.errorToast"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("editor.errorToast"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Card className="glass overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="label-meta px-4 py-3 text-xs">
                    {t("editor.day")}
                  </th>
                  <th className="label-meta px-4 py-3 text-xs">
                    {t("editor.project")}
                  </th>
                  <th className="label-meta px-4 py-3 text-right text-xs">
                    {t("editor.hours")}
                  </th>
                  <th className="label-meta px-4 py-3 text-right text-xs">
                    {t("editor.overtime")}
                  </th>
                  <th className="label-meta px-4 py-3 text-xs">
                    {t("editor.notes")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.map((d, i) => (
                  <tr key={d.work_date} className="border-t border-border/50">
                    <td className="px-4 py-2 tabular-nums align-middle">
                      <div className="flex flex-col">
                        <span>{d.work_date}</span>
                        <span className="text-[10px] text-muted-foreground uppercase">
                          {new Date(`${d.work_date}T00:00:00Z`).toUTCString().slice(0, 3)}
                        </span>
                      </div>
                      <input
                        type="hidden"
                        {...register(`days.${i}.work_date` as const)}
                      />
                    </td>
                    <td className="px-4 py-2 align-middle min-w-[200px]">
                      <Select
                        value={watchedDays[i]?.project_id ?? UNASSIGNED}
                        onValueChange={(v) =>
                          setValue(
                            `days.${i}.project_id` as const,
                            (v as string | null) ?? UNASSIGNED,
                          )
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder={t("editor.unassigned")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED}>
                            {t("editor.unassigned")}
                          </SelectItem>
                          {projects.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-2 align-middle w-24">
                      <Input
                        type="number"
                        step="0.25"
                        min={0}
                        max={24}
                        className="h-8 text-right tabular-nums"
                        {...register(`days.${i}.hours_worked` as const, {
                          valueAsNumber: true,
                        })}
                      />
                    </td>
                    <td className="px-4 py-2 align-middle w-24">
                      <Input
                        type="number"
                        step="0.25"
                        min={0}
                        max={24}
                        className="h-8 text-right tabular-nums"
                        {...register(`days.${i}.hours_overtime` as const, {
                          valueAsNumber: true,
                        })}
                      />
                    </td>
                    <td className="px-4 py-2 align-middle min-w-[220px]">
                      <Input
                        className="h-8 text-xs"
                        placeholder={t("editor.dayNotesPlaceholder")}
                        {...register(`days.${i}.notes` as const)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border/60 bg-muted/30">
                  <td className="px-4 py-3 font-medium">
                    {t("editor.totals")}
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {totals.hours.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {totals.ot.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-1.5">
        <Label htmlFor="notes">{t("editor.notes")}</Label>
        <Textarea
          id="notes"
          rows={3}
          placeholder={t("editor.notesPlaceholder")}
          {...register("notes")}
        />
      </div>

      <div className="flex items-center gap-2 justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? t("editor.submitting") : t("editor.submit")}
        </Button>
      </div>
    </form>
  );
}
