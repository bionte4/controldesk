import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
import { requireCurrentEmployee } from "@/lib/auth/session";
import { BUCKET_ID, SIGNED_URL_TTL_SECONDS } from "@/lib/attachments/constants";
import { formatDateOnly } from "@/lib/format/date";
import { toCanonicalRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";

import { MonthlyReportActionsPanel } from "./actions-panel";

export const metadata: Metadata = { title: "Monthly report" };

const SECTION_ORDER = [
  "EXECUTIVE_SUMMARY",
  "MILESTONE_PROGRESS",
  "HOURS_LOGGED",
  "COSTS_INCURRED",
  "BLOCKERS",
  "NEXT_MONTH_PLAN",
] as const;

/**
 * Detail page for a single monthly report. Renders each section as
 * its own card; the `MonthlyReportActionsPanel` mounts the state
 * machine transitions available to the current user.
 */
export default async function MonthlyReportDetailPage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>;
}) {
  const { id: projectId, reportId } = await params;
  const [employee, t, tStatus, tSections] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("monthlyReport"),
    getTranslations("monthlyReport.status"),
    getTranslations("monthlyReport.sections"),
  ]);
  const supabase = await createClient();

  const [{ data: report }, { data: sections }, { data: project }] =
    await Promise.all([
      supabase
        .from("monthly_reports")
        .select(
          "id, tenant_id, project_id, period_month, status, spv_notes, pm_notes, submitted_at, pm_decided_at, updated_at, sent_to_client_at, sent_to_client_by, client_reviewer_name, client_reviewer_email, client_decided_at, client_decision_notes, client_signature_path, client_signature_file_name, ba_number, ba_period_start, ba_period_end, ba_notes, ba_generated_at, ba_generated_by, submitter:submitter_employee_id(id, full_name), reviewer:pm_reviewer_id(id, full_name), sender:sent_to_client_by(id, full_name), ba_by:ba_generated_by(id, full_name)",
        )
        .eq("id", reportId)
        .eq("tenant_id", employee.tenant_id)
        .maybeSingle(),
      supabase
        .from("monthly_report_sections")
        .select("id, kind, content, metrics, updated_at")
        .eq("report_id", reportId)
        .eq("tenant_id", employee.tenant_id),
      supabase
        .from("projects")
        .select("id, code, name")
        .eq("id", projectId)
        .eq("tenant_id", employee.tenant_id)
        .maybeSingle(),
    ]);
  if (!report || !project) notFound();

  type Report = {
    id: string;
    tenant_id: string;
    project_id: string;
    period_month: string;
    status: string;
    spv_notes: string | null;
    pm_notes: string | null;
    submitted_at: string | null;
    pm_decided_at: string | null;
    updated_at: string;
    // Slice B additions
    sent_to_client_at: string | null;
    sent_to_client_by: string | null;
    client_reviewer_name: string | null;
    client_reviewer_email: string | null;
    client_decided_at: string | null;
    client_decision_notes: string | null;
    client_signature_path: string | null;
    client_signature_file_name: string | null;
    ba_number: string | null;
    ba_period_start: string | null;
    ba_period_end: string | null;
    ba_notes: string | null;
    ba_generated_at: string | null;
    ba_generated_by: string | null;
    submitter: { id: string; full_name: string } | null;
    reviewer: { id: string; full_name: string } | null;
    sender: { id: string; full_name: string } | null;
    ba_by: { id: string; full_name: string } | null;
  };
  const r = report as unknown as Report;

  type Section = {
    id: string;
    kind: (typeof SECTION_ORDER)[number];
    content: string | null;
    metrics: Record<string, unknown> | null;
    updated_at: string;
  };
  const sectionMap = new Map<string, Section>();
  for (const s of (sections ?? []) as unknown as Section[]) {
    sectionMap.set(s.kind, s);
  }

  const canonical = toCanonicalRole(employee.role);
  const isSpv = employee.id === r.submitter?.id;
  const isPm =
    canonical === "PM" ||
    canonical === "OM" ||
    canonical === "DIRECTOR" ||
    canonical === "ADMIN";
  const isFinance =
    canonical === "FINANCE" || canonical === "ADMIN";
  const canEditSections =
    (r.status === "DRAFT_BY_SPV" || r.status === "RETURNED_TO_SPV") &&
    (isSpv || isPm);
  const canSubmit =
    (r.status === "DRAFT_BY_SPV" || r.status === "RETURNED_TO_SPV") && isSpv;
  const canDecide = r.status === "SUBMITTED_TO_PM" && isPm;
  // Slice B — PM-mediated flow.
  const canSendToClient = r.status === "APPROVED_BY_PM" && isPm;
  const canRecordClientDecision = r.status === "SENT_TO_CLIENT" && isPm;
  // BA generation stays with PM but Finance can also trigger it in
  // case the PM is unavailable (billing shouldn't stall on PM leave).
  const canGenerateBa =
    r.status === "APPROVED_BY_CLIENT" && (isPm || isFinance);

  // Sign the client signature file for inline preview (best-effort;
  // failure just leaves the link hidden). Storage RLS ensures the
  // caller sees only their own tenant's files.
  let signedSignatureUrl: string | null = null;
  if (r.client_signature_path) {
    const { data: signed } = await supabase.storage
      .from(BUCKET_ID)
      .createSignedUrl(r.client_signature_path, SIGNED_URL_TTL_SECONDS);
    signedSignatureUrl = signed?.signedUrl ?? null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={
            <Link href={`/projects/${projectId}/monthly-reports`} />
          }
        >
          <ArrowLeft className="size-4" />
          {t("title")}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {project.code} · {r.period_month.slice(0, 7)}
          </h1>
          <p className="text-sm text-muted-foreground">{project.name}</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline">
              {tStatus(r.status as Parameters<typeof tStatus>[0])}
            </Badge>
            {r.submitted_at ? (
              <span className="text-xs text-muted-foreground">
                {t("columns.submittedAt")}: {formatDateOnly(r.submitted_at)}
              </span>
            ) : null}
            {r.pm_decided_at ? (
              <span className="text-xs text-muted-foreground">
                {t("columns.decidedAt")}: {formatDateOnly(r.pm_decided_at)}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {SECTION_ORDER.map((kind) => {
            const s = sectionMap.get(kind);
            return (
              <Card key={kind} className="glass">
                <CardHeader>
                  <CardTitle className="text-base">{tSections(kind)}</CardTitle>
                  {s?.metrics && Object.keys(s.metrics).length > 0 ? (
                    <CardDescription className="text-xs">
                      <MetricsSummary metrics={s.metrics} kind={kind} />
                    </CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {canEditSections ? (
                    <MonthlyReportActionsPanel
                      mode="editSection"
                      reportId={r.id}
                      projectId={projectId}
                      kind={kind}
                      initialContent={s?.content ?? ""}
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">
                      {s?.content?.trim() ? s.content : "—"}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex flex-col gap-4">
          <MonthlyReportActionsPanel
            mode="workflow"
            reportId={r.id}
            projectId={projectId}
            status={r.status}
            canSubmit={canSubmit}
            canDecide={canDecide}
            canSendToClient={canSendToClient}
            canRecordClientDecision={canRecordClientDecision}
            canGenerateBa={canGenerateBa}
            spvNotes={r.spv_notes}
            pmNotes={r.pm_notes}
            clientEmail={r.client_reviewer_email}
            periodMonth={r.period_month}
          />

          {/*
            Slice B — read-only display of client sign-off / BA info.
            Shown once the workflow has reached the relevant stage; the
            interactive form for the *next* transition is rendered by
            the actions panel above.
          */}
          {r.sent_to_client_at ? (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">
                  {t("sliceB.clientCardTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                <div className="text-xs text-muted-foreground">
                  {t("sliceB.sentAt")}: {formatDateOnly(r.sent_to_client_at)}
                  {r.sender?.full_name ? ` · ${r.sender.full_name}` : ""}
                </div>
                {r.client_reviewer_email ? (
                  <div className="text-xs">
                    <span className="text-muted-foreground">
                      {t("sliceB.clientEmail")}:{" "}
                    </span>
                    {r.client_reviewer_email}
                  </div>
                ) : null}
                {r.client_reviewer_name ? (
                  <div className="text-xs">
                    <span className="text-muted-foreground">
                      {t("sliceB.reviewerName")}:{" "}
                    </span>
                    {r.client_reviewer_name}
                    {r.client_decided_at
                      ? ` · ${formatDateOnly(r.client_decided_at)}`
                      : ""}
                  </div>
                ) : null}
                {r.client_decision_notes ? (
                  <div className="rounded border bg-muted/20 p-2 text-xs whitespace-pre-wrap">
                    {r.client_decision_notes}
                  </div>
                ) : null}
                {signedSignatureUrl && r.client_signature_file_name ? (
                  <a
                    href={signedSignatureUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline underline-offset-2 truncate"
                  >
                    {r.client_signature_file_name}
                  </a>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {r.ba_number ? (
            <Card className="glass border-emerald-500/40 bg-emerald-500/5">
              <CardHeader>
                <CardTitle className="text-base">
                  {t("sliceB.baCardTitle")}
                </CardTitle>
                <CardDescription className="font-mono text-emerald-600">
                  {r.ba_number}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {r.ba_period_start && r.ba_period_end ? (
                  <div className="text-xs">
                    <span className="text-muted-foreground">
                      {t("sliceB.baPeriod")}:{" "}
                    </span>
                    {formatDateOnly(r.ba_period_start)} —{" "}
                    {formatDateOnly(r.ba_period_end)}
                  </div>
                ) : null}
                {r.ba_generated_at ? (
                  <div className="text-xs text-muted-foreground">
                    {t("sliceB.baGeneratedAt")}:{" "}
                    {formatDateOnly(r.ba_generated_at)}
                    {r.ba_by?.full_name ? ` · ${r.ba_by.full_name}` : ""}
                  </div>
                ) : null}
                {r.ba_notes ? (
                  <div className="rounded border bg-background/50 p-2 text-xs whitespace-pre-wrap">
                    {r.ba_notes}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MetricsSummary({
  metrics,
  kind,
}: {
  metrics: Record<string, unknown>;
  kind: string;
}) {
  if (kind === "HOURS_LOGGED") {
    const total = Number(metrics.total ?? 0);
    const overtime = Number(metrics.overtime ?? 0);
    return (
      <span>
        Total {total}h · Overtime {overtime}h
      </span>
    );
  }
  if (kind === "MILESTONE_PROGRESS") {
    const done = Number(metrics.completedCount ?? 0);
    const active = Number(metrics.activeCount ?? 0);
    return (
      <span>
        {done} completed · {active} in flight
      </span>
    );
  }
  if (kind === "COSTS_INCURRED") {
    const idr = Number(metrics.approvedIdr ?? 0);
    return <span>IDR {idr.toLocaleString("id-ID")} approved</span>;
  }
  return null;
}
