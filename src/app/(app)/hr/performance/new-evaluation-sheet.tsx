"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Briefcase,
  CalendarClock,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

import { startEvaluationAction } from "./actions";

export type EvaluationEmployeeOption = {
  id: string;
  full_name: string;
  employment_type: string;
  contract_end_date: string;
};

export type EvaluationTemplateOption = { id: string; name: string };

export type EvaluationProjectCandidate = {
  project_id: string;
  project_name: string;
  project_number: string | null;
  primary_pm_id: string | null;
  primary_pm_name: string | null;
};

const NO_PROJECT_VALUE = "__no_project__";

/**
 * Compute the tone for the "days until contract ends" hint. The
 * banded thresholds mirror the HR playbook: <15 days is urgent
 * (rose), 15–30 is a heads-up (amber), >30 is comfortable (emerald).
 * Negative values (past end date) also render as rose.
 */
function contractTone(daysLeft: number): {
  className: string;
  label: string;
} {
  if (daysLeft < 0)
    return {
      className:
        "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      label: "Sudah lewat",
    };
  if (daysLeft < 15)
    return {
      className:
        "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      label: "Segera",
    };
  if (daysLeft < 30)
    return {
      className:
        "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      label: "Menjelang",
    };
  return {
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    label: "Aman",
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const diff = to.getTime() - from.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

export function NewEvaluationSheet({
  employees,
  templates,
  projectCandidatesByEmployee,
}: {
  employees: EvaluationEmployeeOption[];
  templates: EvaluationTemplateOption[];
  projectCandidatesByEmployee?: Record<string, EvaluationProjectCandidate[]>;
}) {
  const t = useTranslations("performance.form");
  const tCommon = useTranslations("common");
  const tPerf = useTranslations("performance");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [empId, setEmpId] = React.useState("");
  const [tplId, setTplId] = React.useState("");
  const [projectId, setProjectId] = React.useState<string>("");
  const [pending, startTransition] = React.useTransition();

  function reset() {
    setEmpId("");
    setTplId("");
    setProjectId("");
  }

  const selectedEmployee = React.useMemo(
    () => employees.find((e) => e.id === empId) ?? null,
    [empId, employees],
  );
  const selectedTemplate = React.useMemo(
    () => templates.find((t) => t.id === tplId) ?? null,
    [tplId, templates],
  );

  // Resetting `projectId` is handled inline in the employee-select
  // callback below (see `onValueChange={...}`). Using an effect for
  // this triggers React Compiler's cascading-render warning because
  // `setProjectId('')` runs synchronously right after another
  // setState.
  const projectCandidates = React.useMemo<EvaluationProjectCandidate[]>(
    () =>
      empId ? projectCandidatesByEmployee?.[empId] ?? [] : [],
    [empId, projectCandidatesByEmployee],
  );

  const selectedProject = React.useMemo(
    () =>
      projectId
        ? projectCandidates.find((p) => p.project_id === projectId) ?? null
        : null,
    [projectId, projectCandidates],
  );

  const contractInfo = React.useMemo(() => {
    if (!selectedEmployee?.contract_end_date) return null;
    const today = new Date().toISOString().slice(0, 10);
    const days = daysBetween(today, selectedEmployee.contract_end_date);
    return { days, tone: contractTone(days) };
  }, [selectedEmployee]);

  function onSubmit() {
    if (!empId || !tplId) {
      toast.error("Pick an employee + template first.");
      return;
    }
    startTransition(async () => {
      const res = await startEvaluationAction({
        employee_id: empId,
        template_id: tplId,
        ...(projectId ? { project_id: projectId } : {}),
      });
      if (res.ok) {
        toast.success("Evaluation started.");
        setOpen(false);
        reset();
        router.push(`/hr/performance/${res.data.id}`);
      } else {
        toast.error(res.reason ?? "Failed to start evaluation.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button>
            <Plus className="size-4" />
            {tPerf("newEvaluation")}
          </Button>
        }
      />
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{tPerf("newEvaluation")}</SheetTitle>
          <SheetDescription>{t("employeeHint")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-4">
          {/*
            Two-column grid on md+: employee picker on the left, template
            picker on the right. Below on small screens they stack. Each
            block renders its own live preview card so the form stops
            feeling empty once a value is chosen.
          */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserRound className="size-4 text-muted-foreground" />
                <span>{t("employee")}</span>
              </div>
              <Select
                value={empId}
                onValueChange={(v) => {
                  setEmpId(v ?? "");
                  setProjectId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("employeePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      <span>
                        {e.full_name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {e.employment_type} · ends {e.contract_end_date}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Employee preview card — only visible once picked. */}
              {selectedEmployee ? (
                <div className="glass rounded-lg border p-3 text-sm">
                  <div className="font-medium">
                    {selectedEmployee.full_name}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[11px]">
                      {selectedEmployee.employment_type}
                    </Badge>
                    {contractInfo ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px]",
                          contractInfo.tone.className,
                        )}
                      >
                        <CalendarClock className="mr-1 size-3" />
                        {contractInfo.days < 0
                          ? `${Math.abs(contractInfo.days)} hari lewat`
                          : `${contractInfo.days} hari lagi`}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Kontrak berakhir{" "}
                    <span className="font-mono">
                      {selectedEmployee.contract_end_date}
                    </span>
                    {contractInfo ? ` · ${contractInfo.tone.label}` : ""}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Pilih karyawan non-permanent untuk melihat detail kontrak.
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4 text-muted-foreground" />
                <span>{t("template")}</span>
              </div>
              <Select value={tplId} onValueChange={(v) => setTplId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder={t("templatePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate ? (
                <div className="glass rounded-lg border p-3 text-sm">
                  <div className="font-medium">{selectedTemplate.name}</div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t("templateHint")}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  {t("templateHint")}
                </div>
              )}
            </div>
          </div>

          {/*
            Optional project context — surfaces the employee's ACTIVE
            project assignments so SPV can attach the eval to the
            proyek they were actually shipping. Reviewer preview
            auto-resolves to that project's PRIMARY_PM.

            Kept OUTSIDE the two-column grid so the dropdown gets full
            width for long project names and the preview card can
            stack under it on mobile.
          */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Briefcase className="size-4 text-muted-foreground" />
              <span>{t("projectContext")}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                · {t("optional")}
              </span>
            </div>
            <Select
              value={projectId || NO_PROJECT_VALUE}
              onValueChange={(v) =>
                setProjectId(v && v !== NO_PROJECT_VALUE ? v : "")
              }
              disabled={!empId}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("projectContextPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT_VALUE}>
                  {t("projectContextNone")}
                </SelectItem>
                {projectCandidates.map((p) => (
                  <SelectItem key={p.project_id} value={p.project_id}>
                    <span>
                      {p.project_number ? (
                        <span className="text-xs font-mono text-muted-foreground mr-1.5">
                          {p.project_number}
                        </span>
                      ) : null}
                      {p.project_name}
                      {p.primary_pm_name ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          · PM: {p.primary_pm_name}
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {empId && projectCandidates.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t("projectContextEmpty")}
              </p>
            ) : null}
            {selectedProject ? (
              <div className="glass rounded-lg border p-3 text-sm">
                <div className="font-medium">
                  {selectedProject.project_name}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {selectedProject.primary_pm_name ? (
                    <>
                      {t("projectReviewerPreview", {
                        name: selectedProject.primary_pm_name,
                      })}
                    </>
                  ) : (
                    <>{t("projectReviewerMissing")}</>
                  )}
                </p>
              </div>
            ) : null}
          </div>

          {/*
            "What happens next" tips card — fills the vertical whitespace
            with useful context so the user understands the workflow.
          */}
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-indigo-500" />
              <span>Setelah tekan &ldquo;Start evaluation&rdquo;</span>
            </div>
            <ol className="mt-2 space-y-1 pl-6 text-xs text-muted-foreground list-decimal">
              <li>
                Sistem membuat draft dengan semua aspek dari template terpilih.
              </li>
              <li>
                SPV mengisi skor 1–5 + komentar wajib untuk tiap aspek.
              </li>
              <li>
                Alur approval: <strong>SPV → PM → OM</strong>. Finance
                menerima notifikasi setelah OM approve.
              </li>
              <li>
                Untuk kontrak PKWT final, aktifkan toggle{" "}
                <em>&ldquo;Periode final&rdquo;</em> di halaman detail agar
                muncul kartu Kesimpulan (3 kriteria: Goal ≥95%, Manajemen ≥3.0,
                Kompetensi ≥90%).
              </li>
            </ol>
          </div>

          {/* Compact meta hint when everything is filled */}
          {selectedEmployee && selectedTemplate ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2.5 text-xs text-emerald-700 dark:text-emerald-300">
              <ClipboardList className="size-4" />
              <span>
                Siap membuat evaluasi{" "}
                <strong>{selectedTemplate.name}</strong> untuk{" "}
                <strong>{selectedEmployee.full_name}</strong>.
              </span>
            </div>
          ) : null}
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <SheetClose
            render={
              <Button variant="ghost" disabled={pending}>
                {tCommon("cancel")}
              </Button>
            }
          />
          <Button onClick={onSubmit} disabled={pending || !empId || !tplId}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("startEvaluation")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
