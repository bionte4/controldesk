"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Eye, FileSpreadsheet, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReportFilter, ReportKind } from "@/lib/reports/registry";

type ProjectOption = { id: string; label: string };
type FundOption = { id: string; label: string };

type Props = {
  kind: ReportKind;
  filters: readonly ReportFilter[];
  defaults: {
    from: string;
    to: string;
    fiscalYear: number;
  };
  projects: ProjectOption[];
  funds: FundOption[];
};

/**
 * Client component that renders the filter form + Preview / PDF /
 * XLSX / CSV action buttons. On "Preview" we push the current filter
 * state into the URL query string so the server component
 * (`page.tsx`) can re-render with fresh data. On export buttons we
 * navigate to the API route which streams the file directly to the
 * browser download bar.
 */
export function ReportFilterPanel({
  kind,
  filters,
  defaults,
  projects,
  funds,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [previewPending, startPreview] = React.useTransition();

  const [from, setFrom] = React.useState(params.get("from") ?? defaults.from);
  const [to, setTo] = React.useState(params.get("to") ?? defaults.to);
  const [projectId, setProjectId] = React.useState(
    params.get("projectId") ?? "",
  );
  const [projectIds, setProjectIds] = React.useState<string[]>(
    params.getAll("projectId"),
  );
  const [fiscalYear, setFiscalYear] = React.useState(
    params.get("fiscalYear") ?? String(defaults.fiscalYear),
  );
  const [fundId, setFundId] = React.useState(params.get("fundId") ?? "");
  const [expenseStatus, setExpenseStatus] = React.useState(
    params.get("expenseStatus") ?? "",
  );
  const [caStatus, setCaStatus] = React.useState(params.get("caStatus") ?? "");
  const [brKind, setBrKind] = React.useState(params.get("brKind") ?? "");

  function toQuery(preview: boolean): string {
    const q = new URLSearchParams();
    if (filters.includes("dateRange")) {
      if (from) q.set("from", from);
      if (to) q.set("to", to);
    }
    if (filters.includes("project") && projectId) q.set("projectId", projectId);
    if (filters.includes("projectMulti")) {
      for (const p of projectIds) q.append("projectId", p);
    }
    if (filters.includes("fiscalYear") && fiscalYear) {
      q.set("fiscalYear", fiscalYear);
    }
    if (filters.includes("fund") && fundId) q.set("fundId", fundId);
    if (filters.includes("expenseStatus") && expenseStatus)
      q.set("expenseStatus", expenseStatus);
    if (filters.includes("caStatus") && caStatus) q.set("caStatus", caStatus);
    if (filters.includes("brKind") && brKind) q.set("brKind", brKind);
    if (preview) q.set("preview", "1");
    return q.toString();
  }

  function onPreview() {
    startPreview(() => {
      router.replace(`/reports/${kind}?${toQuery(true)}`);
    });
  }

  function onDownload(format: "csv" | "xlsx" | "pdf") {
    // Direct GET — browser handles the file download via
    // `Content-Disposition: attachment` on the API side.
    const q = new URLSearchParams(toQuery(false));
    q.set("format", format);
    window.location.href = `/api/reports/${kind}?${q.toString()}`;
  }

  return (
    <div className="grid gap-4">
      {/* Filters */}
      <div className="grid gap-3 md:grid-cols-2">
        {filters.includes("dateRange") ? (
          <>
            <div className="grid gap-1">
              <Label htmlFor="from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </>
        ) : null}

        {filters.includes("fiscalYear") ? (
          <div className="grid gap-1">
            <Label htmlFor="fy" className="text-xs text-muted-foreground">
              Fiscal year
            </Label>
            <Input
              id="fy"
              type="number"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              min={2020}
              max={2100}
            />
          </div>
        ) : null}

        {filters.includes("project") ? (
          <div className="grid gap-1 md:col-span-2">
            <Label className="text-xs text-muted-foreground">Project</Label>
            <Select
              value={projectId}
              onValueChange={(v) => setProjectId(v === "__all" ? "" : (v ?? ""))}
            >
              <SelectTrigger>
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {filters.includes("projectMulti") ? (
          <div className="grid gap-1 md:col-span-2">
            <Label className="text-xs text-muted-foreground">
              Projects ({projectIds.length || "All"})
            </Label>
            <div className="max-h-[160px] overflow-auto rounded-lg border p-2 grid gap-1">
              {projects.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No accessible projects.
                </p>
              ) : (
                projects.map((p) => {
                  const checked = projectIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-sm rounded-md px-2 py-1 hover:bg-muted/40 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={checked}
                        onChange={(e) => {
                          setProjectIds((prev) =>
                            e.target.checked
                              ? [...prev, p.id]
                              : prev.filter((x) => x !== p.id),
                          );
                        }}
                      />
                      <span className="truncate">{p.label}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {filters.includes("fund") ? (
          <div className="grid gap-1 md:col-span-2">
            <Label className="text-xs text-muted-foreground">Fund</Label>
            <Select
              value={fundId}
              onValueChange={(v) => setFundId(v === "__all" ? "" : (v ?? ""))}
            >
              <SelectTrigger>
                <SelectValue placeholder="All funds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All funds</SelectItem>
                {funds.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {filters.includes("expenseStatus") ? (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              Expense status
            </Label>
            <Select
              value={expenseStatus}
              onValueChange={(v) =>
                setExpenseStatus(v === "__any" ? "" : (v ?? ""))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any">Any status</SelectItem>
                <SelectItem value="DRAFT">DRAFT</SelectItem>
                <SelectItem value="PENDING_L1">PENDING_L1</SelectItem>
                <SelectItem value="PENDING_L2">PENDING_L2</SelectItem>
                <SelectItem value="PENDING_L2_5">PENDING_L2_5</SelectItem>
                <SelectItem value="PENDING_L3">PENDING_L3</SelectItem>
                <SelectItem value="APPROVED">APPROVED</SelectItem>
                <SelectItem value="REJECTED">REJECTED</SelectItem>
                <SelectItem value="CANCELLED">CANCELLED</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {filters.includes("caStatus") ? (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">CA status</Label>
            <Select
              value={caStatus}
              onValueChange={(v) => setCaStatus(v === "__any" ? "" : (v ?? ""))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any">Any status</SelectItem>
                <SelectItem value="DRAFT">DRAFT</SelectItem>
                <SelectItem value="PENDING_SUPERVISOR">PENDING_SUPERVISOR</SelectItem>
                <SelectItem value="PENDING_PM">PENDING_PM</SelectItem>
                <SelectItem value="PENDING_FINANCE">PENDING_FINANCE</SelectItem>
                <SelectItem value="PENDING_OM">PENDING_OM</SelectItem>
                <SelectItem value="PENDING_DIRECTOR">PENDING_DIRECTOR</SelectItem>
                <SelectItem value="APPROVED">APPROVED</SelectItem>
                <SelectItem value="DISBURSED">DISBURSED</SelectItem>
                <SelectItem value="SETTLED">SETTLED</SelectItem>
                <SelectItem value="REJECTED">REJECTED</SelectItem>
                <SelectItem value="CANCELLED">CANCELLED</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {filters.includes("brKind") ? (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              Request kind
            </Label>
            <Select
              value={brKind}
              onValueChange={(v) => setBrKind(v === "__any" ? "" : (v ?? ""))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any">Any kind</SelectItem>
                <SelectItem value="INCREASE">INCREASE</SelectItem>
                <SelectItem value="DECREASE">DECREASE</SelectItem>
                <SelectItem value="TRANSFER">TRANSFER</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" render={<Link href="/reports" />}>
          Back
        </Button>
        <Button variant="outline" size="sm" onClick={onPreview} disabled={previewPending}>
          {previewPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Eye className="size-4" />
          )}
          Preview
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={() => onDownload("pdf")}
          title="Download as PDF"
        >
          <FileText className="size-4" />
          PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDownload("xlsx")}
          title="Download as Excel workbook"
        >
          <FileSpreadsheet className="size-4" />
          XLSX
        </Button>
        <Button variant="outline" size="sm" onClick={() => onDownload("csv")}>
          <Download className="size-4" />
          CSV
        </Button>
      </div>
    </div>
  );
}
