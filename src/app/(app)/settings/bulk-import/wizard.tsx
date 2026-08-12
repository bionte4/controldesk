"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IMPORT_LIMITS } from "@/lib/import/limits";
import type { ImportResource } from "@/lib/import/types";

import {
  dryRunImportAction,
  runImportAction,
  type DryRunResult,
  type CommitResult,
} from "./actions";

type ColumnDescriptor = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  example: string;
  enumValues?: string[];
  refHint?: string;
};

type ResourceSummary = {
  resource: ImportResource;
  label: string;
  subtitle: string;
  columns: ColumnDescriptor[];
  grid: boolean;
};

type Labels = {
  rowCap: string;
  fileCap: string;
  chooseResource: string;
  oneRowRecord: string;
  oneCsvGrid: string;
  downloadTemplate: string;
  downloadTemplateXlsx: string;
  downloadTemplateCsv: string;
  chooseFile: string;
  replaceFile: string;
  dryRun: string;
  runImport: string;
  running: string;
  columnHeader: string;
  column_col: string;
  column_label: string;
  column_type: string;
  column_required: string;
  column_example: string;
  required_yes: string;
  required_no: string;
  previewTitle: string;
  previewValid: string;
  previewInvalid: string;
  previewInsert: string;
  previewUpdate: string;
  previewErrors: string;
  previewSample: string;
  resultOk: string;
  resultFailed: string;
  resultInserted: string;
  resultUpdated: string;
  successToast: string;
  errorToast: string;
  historyTitle: string;
  historyEmpty: string;
  historyResource: string;
  historyFile: string;
  historyRows: string;
  historyStatus: string;
  historyWhen: string;
  statusDryRun: string;
  statusCommitted: string;
  statusFailed: string;
};

type RecentJob = {
  id: string;
  resource: ImportResource;
  resource_label: string;
  status: "DRY_RUN" | "COMMITTED" | "FAILED";
  file_name: string;
  row_count: number;
  valid_row_count: number;
  invalid_row_count: number;
  inserted_count: number;
  updated_count: number;
  created_at: string;
  committed_at: string | null;
};

const TYPE_TONE: Record<string, string> = {
  string: "border-slate-400/30 bg-slate-500/10 text-slate-300",
  email: "border-cyan-400/30 bg-cyan-500/10 text-cyan-300",
  phone: "border-teal-400/30 bg-teal-500/10 text-teal-300",
  date: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  number: "border-blue-400/30 bg-blue-500/10 text-blue-300",
  money: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  enum: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-300",
  ref: "border-indigo-400/30 bg-indigo-500/10 text-indigo-300",
  boolean: "border-orange-400/30 bg-orange-500/10 text-orange-300",
};

const STATUS_TONE: Record<RecentJob["status"], string> = {
  DRY_RUN: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  COMMITTED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  FAILED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

export function BulkImportWizard({
  resources,
  labels,
  recentJobs,
}: {
  resources: ResourceSummary[];
  labels: Labels;
  recentJobs: RecentJob[];
}) {
  const [selected, setSelected] = React.useState<ImportResource>(
    resources[0]?.resource ?? "EMPLOYEE",
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [dryRun, setDryRun] = React.useState<DryRunResult | null>(null);
  const [pending, startTransition] = React.useTransition();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const activeResource =
    resources.find((r) => r.resource === selected) ?? resources[0];

  // Reset preview inline whenever resource or file changes — doing this
  // in a useEffect() with `setDryRun(null)` cascades an extra render
  // (`react-hooks/set-state-in-effect`), so we clear at the point the
  // input changes.
  function selectResource(next: ImportResource) {
    if (next === selected) return;
    setSelected(next);
    setDryRun(null);
  }

  function onChooseFile(f: File | null) {
    if (!f) {
      setFile(null);
      setDryRun(null);
      return;
    }
    if (f.size > IMPORT_LIMITS.maxFileBytes) {
      toast.error(
        `File is ${(f.size / 1024 / 1024).toFixed(2)} MB — max ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB.`,
      );
      return;
    }
    setFile(f);
    setDryRun(null);
  }

  function onDryRun() {
    if (!file) {
      toast.error("Pick a file first.");
      return;
    }
    const fd = new FormData();
    fd.set("resource", selected);
    fd.set("file", file);
    startTransition(async () => {
      const res = await dryRunImportAction(fd);
      setDryRun(res);
      if (!res.ok) {
        toast.error(res.reason);
      }
    });
  }

  function onRunImport() {
    if (!file) {
      toast.error("Pick a file first.");
      return;
    }
    if (!dryRun || !dryRun.ok || dryRun.invalid_count > 0) {
      toast.error("Dry-run must be clean (0 errors) before running import.");
      return;
    }
    const fd = new FormData();
    fd.set("resource", selected);
    fd.set("file", file);
    startTransition(async () => {
      const res: CommitResult = await runImportAction(fd);
      if (res.ok) {
        toast.success(
          `${labels.successToast} · +${res.inserted} inserted · ~${res.updated} updated`,
        );
        setFile(null);
        setDryRun(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        toast.error(res.reason);
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
      {/* Left rail — resource picker */}
      <aside className="flex flex-col gap-3">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {labels.chooseResource}
        </div>
        <div className="flex flex-col gap-2">
          {resources.map((r) => {
            const active = r.resource === selected;
            return (
              <button
                type="button"
                key={r.resource}
                onClick={() => selectResource(r.resource)}
                className={`flex items-center justify-between rounded-lg border p-4 text-left transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary-foreground"
                    : "border-border/50 bg-card/60 hover:bg-muted/40"
                }`}
              >
                <div>
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.grid ? labels.oneCsvGrid : labels.oneRowRecord}
                  </div>
                </div>
                <ChevronRight
                  className={`size-4 ${active ? "opacity-100" : "opacity-40"}`}
                />
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right panel — active resource */}
      <section className="flex flex-col gap-4">
        <Card className="glass">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex-1">
              <CardTitle className="text-base">
                {activeResource?.label}
              </CardTitle>
              <CardDescription>{activeResource?.subtitle}</CardDescription>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>{labels.rowCap}</div>
              <div>{labels.fileCap}</div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Upload + template actions */}
            <div className="flex flex-wrap items-center gap-3">
              <TemplateDropdown
                resource={selected}
                labels={{
                  downloadTemplate: labels.downloadTemplate,
                  downloadTemplateXlsx: labels.downloadTemplateXlsx,
                  downloadTemplateCsv: labels.downloadTemplateCsv,
                }}
              />
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                ref={fileInputRef}
                onChange={(e) => onChooseFile(e.target.files?.[0] ?? null)}
                className="hidden"
                id="bulk-import-file"
              />
              <Button
                variant="outline"
                className="cursor-pointer"
                render={
                  <label htmlFor="bulk-import-file" className="cursor-pointer" />
                }
              >
                <Upload className="mr-2 size-4" />
                {file ? labels.replaceFile : labels.chooseFile}
              </Button>
              {file ? (
                <span className="text-xs text-muted-foreground">
                  {file.name} · {(file.size / 1024).toFixed(1)} KB
                </span>
              ) : null}
            </div>

            {/* Column reference table */}
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <Th>{labels.column_col}</Th>
                    <Th>{labels.column_label}</Th>
                    <Th>{labels.column_type}</Th>
                    <Th>{labels.column_required}</Th>
                    <Th>{labels.column_example}</Th>
                  </tr>
                </thead>
                <tbody>
                  {activeResource?.columns.map((c) => (
                    <tr key={c.key} className="border-t border-border/50">
                      <td className="px-4 py-2 font-mono text-xs text-rose-400">
                        {c.key}
                      </td>
                      <td className="px-4 py-2">{c.label}</td>
                      <td className="px-4 py-2">
                        <Badge
                          variant="outline"
                          className={TYPE_TONE[c.type] ?? TYPE_TONE.string}
                        >
                          {c.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        {c.required ? (
                          <Badge
                            variant="outline"
                            className="border-rose-400/30 bg-rose-500/10 text-rose-300"
                          >
                            {labels.required_yes}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {labels.required_no}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {c.example}
                        {c.refHint ? (
                          <span className="ml-2 italic">({c.refHint})</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action row */}
            <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
              <Button
                variant="outline"
                disabled={!file || pending}
                onClick={onDryRun}
              >
                <FileSpreadsheet className="mr-2 size-4" />
                {pending && dryRun === null ? labels.running : labels.dryRun}
              </Button>
              <Button
                disabled={
                  !file ||
                  pending ||
                  !dryRun ||
                  !dryRun.ok ||
                  dryRun.invalid_count > 0
                }
                onClick={onRunImport}
              >
                {pending && dryRun !== null
                  ? labels.running
                  : labels.runImport}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Dry-run preview */}
        {dryRun && dryRun.ok ? (
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">
                {labels.previewTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-3 md:grid-cols-4">
                <Stat label={labels.previewValid} value={dryRun.valid_count} tone="emerald" />
                <Stat
                  label={labels.previewInvalid}
                  value={dryRun.invalid_count}
                  tone={dryRun.invalid_count > 0 ? "rose" : "slate"}
                />
                <Stat label={labels.previewInsert} value={dryRun.inserted_preview} tone="indigo" />
                <Stat label={labels.previewUpdate} value={dryRun.updated_preview} tone="amber" />
              </div>

              {dryRun.errors.length > 0 ? (
                <details className="rounded-lg border border-rose-400/30 bg-rose-500/5 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-rose-400">
                    {labels.previewErrors} ({dryRun.errors.length})
                  </summary>
                  <div className="mt-2 max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1">Row</th>
                          <th className="px-2 py-1">Field</th>
                          <th className="px-2 py-1">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dryRun.errors.map((e, i) => (
                          <tr key={i} className="border-t border-border/30">
                            <td className="px-2 py-1 font-mono text-xs">
                              {e.row_number}
                            </td>
                            <td className="px-2 py-1 font-mono text-xs">
                              {e.field ?? "—"}
                            </td>
                            <td className="px-2 py-1">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Recent history */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">{labels.historyTitle}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentJobs.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {labels.historyEmpty}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left">
                    <tr>
                      <Th>{labels.historyResource}</Th>
                      <Th>{labels.historyFile}</Th>
                      <Th>{labels.historyRows}</Th>
                      <Th>{labels.historyStatus}</Th>
                      <Th>{labels.historyWhen}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map((j) => (
                      <tr key={j.id} className="border-t border-border/50">
                        <td className="px-4 py-2">{j.resource_label}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {j.file_name}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {j.status === "COMMITTED"
                            ? `+${j.inserted_count} · ~${j.updated_count}`
                            : `${j.valid_row_count}✓ / ${j.invalid_row_count}✗ of ${j.row_count}`}
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant="outline"
                            className={STATUS_TONE[j.status]}
                          >
                            {j.status === "DRY_RUN"
                              ? labels.statusDryRun
                              : j.status === "COMMITTED"
                                ? labels.statusCommitted
                                : labels.statusFailed}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {new Date(
                            j.committed_at ?? j.created_at,
                          ).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function TemplateDropdown({
  resource,
  labels,
}: {
  resource: ImportResource;
  labels: { downloadTemplate: string; downloadTemplateXlsx: string; downloadTemplateCsv: string };
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline">
            <Download className="mr-2 size-4" />
            {labels.downloadTemplate}
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          render={
            <Link
              href={`/api/bulk-import/template/${resource}?format=xlsx`}
              prefetch={false}
            />
          }
        >
          {labels.downloadTemplateXlsx}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <Link
              href={`/api/bulk-import/template/${resource}?format=csv`}
              prefetch={false}
            />
          }
        >
          {labels.downloadTemplateCsv}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "indigo" | "amber" | "slate";
}) {
  const toneClass = {
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    indigo: "text-indigo-300",
    amber: "text-amber-300",
    slate: "text-slate-300",
  }[tone];
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${toneClass}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"
    >
      {children}
    </th>
  );
}
