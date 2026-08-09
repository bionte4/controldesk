import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Wallet } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ApprovalChainProgress } from "@/components/approvals/approval-chain-progress";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { FinanceStatusBadge } from "@/components/finance/finance-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { businessDaysUntil } from "@/lib/format/business-days";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import {
  formatRole,
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type CanonicalApprovalSlot,
} from "@/lib/rbac/roles";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  CA_STATUS_LABEL,
  CA_STATUS_TONE,
  canApproveNextCa,
} from "@/lib/cash-advance/state";
import {
  CANONICAL_CA_STATUS_LABEL,
  CANONICAL_CA_STATUS_SLOT,
  CANONICAL_CA_STATUS_TONE,
  caCanonicalChain,
  canonicalCaCanApprove,
  isCanonicalCaStatus,
  type CanonicalCaStatus,
} from "@/lib/cash-advance/state-canonical";
import type { EmployeeRole } from "@/lib/rbac/roles";
import type {
  ApprovalAction,
  CashAdvanceStatus,
  CashAdvanceSettlementStatus,
  CashAdvanceType,
} from "@/types/database";

import { listAttachmentsSigned } from "@/lib/attachments";

import { CashAdvanceActionButtons } from "../cash-advance-action-buttons";
import { SubmitSettlementDialog } from "../settlement-panel";
import { SettlementReviewButtons } from "../settlement-review-buttons";
import {
  AttachedCashAdvanceFiles,
  SettlementAttachmentList,
  UploadCashAdvanceAttachments,
  type CashAdvanceAttachmentEntry,
} from "../attachment-widgets";

export const metadata: Metadata = { title: "Cash Advance" };

const ACTION_LABEL: Record<ApprovalAction, string> = {
  SUBMIT: "Submitted",
  APPROVE: "Approved",
  REJECT: "Rejected",
  CANCEL: "Cancelled",
  FINANCE_APPROVE: "Finance approved",
  FINANCE_REJECT: "Finance rejected",
};

const ACTION_TONE: Record<ApprovalAction, string> = {
  SUBMIT: "bg-primary/15 text-primary border-primary/30",
  APPROVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  REJECT: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  CANCEL: "bg-muted text-muted-foreground border-border",
  FINANCE_APPROVE: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  FINANCE_REJECT: "bg-rose-500/15 text-rose-500 border-rose-500/30",
};

const SETTLEMENT_TONE: Record<CashAdvanceSettlementStatus, string> = {
  DRAFT: "border-white/10 bg-white/5 text-white/70",
  SUBMITTED: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  ACCEPTED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  RETURNED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

export default async function CashAdvanceDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const [employee, t, tSlots, tAttach] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("cashAdvances.detail"),
    getTranslations("cashAdvances.chainSlot"),
    getTranslations("cashAdvances.attachments"),
  ]);

  const supabase = await createClient();

  type CaView = {
    id: string;
    amount: string;
    purpose: string;
    needed_by: string | null;
    status: CashAdvanceStatus;
    ca_type: CashAdvanceType | null;
    created_at: string;
    rejection_reason: string | null;
    net_settlement_amount: string | null;
    settlement_due_at: string | null;
    disbursed_at: string | null;
    requester_employee_id: string;
    project_id: string;
    coa_id: string | null;
    projects: { id: string; code: string; name: string } | null;
    requester: { id: string; full_name: string; role: string } | null;
    coa: { id: string; code: string; name: string } | null;
  };
  type LogView = {
    id: number;
    action: ApprovalAction;
    actor_role: string | null;
    from_status: CashAdvanceStatus;
    to_status: CashAdvanceStatus;
    comment: string | null;
    created_at: string;
    actor: { full_name: string } | null;
  };
  type SettlementView = {
    id: string;
    status: CashAdvanceSettlementStatus;
    total_spent: string;
    submitted_at: string | null;
    accepted_at: string | null;
    returned_at: string | null;
    return_reason: string | null;
    notes: string | null;
    submitter: { full_name: string } | null;
  };

  const [{ data: caRaw }, { data: logsRaw }, { data: settlementsRaw }] =
    await Promise.all([
      supabase
        .from("cash_advances")
        .select(
          "*, projects(id, code, name), requester:requester_employee_id(id, full_name, role), coa:coa_id(id, code, name)",
        )
        .eq("id", id)
        .eq("tenant_id", employee.tenant_id)
        .maybeSingle(),
      supabase
        .from("cash_advance_approval_logs")
        .select(
          "id, action, actor_role, from_status, to_status, comment, created_at, actor:actor_employee_id(full_name)",
        )
        .eq("cash_advance_id", id)
        .eq("tenant_id", employee.tenant_id)
        .order("created_at", { ascending: true }),
      supabase
        .from("cash_advance_settlements")
        .select(
          "id, status, total_spent, submitted_at, accepted_at, returned_at, return_reason, notes, submitter:submitted_by(full_name)",
        )
        .eq("cash_advance_id", id)
        .eq("tenant_id", employee.tenant_id)
        .order("created_at", { ascending: false }),
    ]);

  if (!caRaw) notFound();

  const ca = caRaw as unknown as CaView;
  const logs = (logsRaw ?? []) as unknown as LogView[];
  const settlements = (settlementsRaw ?? []) as unknown as SettlementView[];

  // Load nota/struk attachments for every settlement in parallel. These
  // are separate from CA-level supporting docs (resource_type = "cash_advance")
  // so Finance can review evidence per-submission when the CA has multiple
  // settlement iterations (RETURNED + resubmit).
  const settlementAttachmentEntries = await Promise.all(
    settlements.map(async (s) => {
      const rows = await listAttachmentsSigned(
        "cash_advance_settlement",
        s.id,
      );
      return {
        settlementId: s.id,
        files: rows.map((a) => ({
          id: a.id,
          filename: a.filename,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          signed_url: a.signed_url,
        })),
      };
    }),
  );
  const settlementAttachmentMap = new Map(
    settlementAttachmentEntries.map((e) => [e.settlementId, e.files]),
  );

  // Latest RETURNED submission's attachments will be copy-forwarded into
  // the new submission — surface the count so the requester knows.
  const latestReturned = settlements
    .filter((s) => s.status === "RETURNED")
    .sort((a, b) =>
      (b.returned_at ?? "").localeCompare(a.returned_at ?? ""),
    )[0];
  const priorReturnedAttachmentCount = latestReturned
    ? (settlementAttachmentMap.get(latestReturned.id)?.length ?? 0)
    : 0;

  const status = ca.status;
  const project = ca.projects;
  const requester = ca.requester;
  const caType: CashAdvanceType = ca.ca_type ?? "GENERAL";
  const isCanonicalRow = isCanonicalCaStatus(status);
  const flow: "legacy" | "canonical" = isCanonicalRow ? "canonical" : "legacy";
  const canonicalRole = toCanonicalRole(employee.role as AnyDbEmployeeRole);
  const canApprove = isCanonicalRow
    ? canonicalCaCanApprove({ actorRole: canonicalRole, current: status })
    : canApproveNextCa(employee.role as EmployeeRole, status);
  const isRequester = ca.requester_employee_id === employee.id;
  const canDisburse =
    status === "APPROVED" &&
    (canonicalRole === "FINANCE" || canonicalRole === "ADMIN");
  const canSubmitSettlement = status === "DISBURSED" && isRequester;
  const canReviewSettlement =
    canonicalRole === "FINANCE" || canonicalRole === "ADMIN";
  const netSettlement =
    ca.net_settlement_amount != null
      ? parseMoneyFromDb(ca.net_settlement_amount)
      : null;

  const amountIDR = Number(parseMoneyFromDb(ca.amount));
  const canonicalChain: CanonicalApprovalSlot[] = isCanonicalRow
    ? caCanonicalChain({ type: caType, amountIDR })
    : [];

  // Supporting attachments (Gmap screenshot, memo pendukung, foto site).
  // Load-and-sign in the RSC so client widgets get short-lived URLs. The
  // owner can add/remove while the CA is still editable; approvers see
  // the same set read-only.
  const attachmentsSigned = await listAttachmentsSigned("cash_advance", ca.id);
  const attachmentEntries: CashAdvanceAttachmentEntry[] = attachmentsSigned.map(
    (a) => ({
      id: a.id,
      filename: a.filename,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      signed_url: a.signed_url,
    }),
  );

  const ATTACHMENT_EDITABLE_STATES: CashAdvanceStatus[] = [
    "DRAFT",
    "PENDING_SUPERVISOR",
    "PENDING_L1_SUPERVISOR",
  ];
  const canEditAttachments =
    isRequester && ATTACHMENT_EDITABLE_STATES.includes(status);

  function caLabel(s: CashAdvanceStatus): string {
    const canonical =
      (CANONICAL_CA_STATUS_LABEL as Partial<Record<CashAdvanceStatus, string>>)[
        s
      ];
    return canonical ?? CA_STATUS_LABEL[s];
  }
  function caTone(s: CashAdvanceStatus): string {
    const canonical =
      (CANONICAL_CA_STATUS_TONE as Partial<Record<CashAdvanceStatus, string>>)[
        s
      ];
    return canonical ?? CA_STATUS_TONE[s];
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/finance/cash-advances" />}
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {canApprove ? (
            <CashAdvanceActionButtons
              id={ca.id}
              mode="approve"
              flow={flow}
            />
          ) : null}
          {canDisburse ? (
            <CashAdvanceActionButtons
              id={ca.id}
              mode="disburse"
              flow={flow}
            />
          ) : null}
          {canSubmitSettlement ? (
            <SubmitSettlementDialog
              cashAdvanceId={ca.id}
              priorReturnedAttachmentCount={priorReturnedAttachmentCount}
            />
          ) : null}
        </div>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="size-6" />
          </div>
          <div>
            <p className="label-meta">
              {t("kicker")}
              {project ? (
                <span className="ml-2 font-mono text-muted-foreground">
                  {project.code}
                </span>
              ) : null}
            </p>
            <h1 className="font-display text-2xl font-semibold tracking-tight max-w-2xl">
              {ca.purpose}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <FinanceStatusBadge
                tone={caTone(status)}
                label={caLabel(status)}
                data-testid="ca-status-badge"
              />
              <Badge
                variant="outline"
                className={
                  caType === "FIELD_OPS"
                    ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                    : "border-slate-400/30 bg-slate-500/10 text-slate-300"
                }
              >
                {t(`type.${caType}`)}
              </Badge>
              {project ? (
                <Link
                  href={`/projects/${project.id}`}
                  className="text-sm text-muted-foreground hover:text-primary"
                >
                  {project.name}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="label-meta">{t("amount")}</p>
          <p className="font-display text-3xl font-semibold tracking-tight tabular-nums">
            {formatIDR(parseMoneyFromDb(ca.amount))}
          </p>
          {ca.needed_by ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("neededBy", {
                date: formatInTz(ca.needed_by, "dd MMM yyyy"),
              })}
            </p>
          ) : null}
          {ca.coa ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("coaLabel")}: {ca.coa.code} · {ca.coa.name}
            </p>
          ) : null}
        </div>
      </header>

      {status === "DISBURSED" && ca.settlement_due_at ? (
        (() => {
          const delta = businessDaysUntil(ca.settlement_due_at, new Date());
          const dueLabel = formatInTz(ca.settlement_due_at, "dd MMM yyyy");
          let tone = "";
          let title = "";
          let body = "";
          if (delta > 3) {
            return null; // > 3 wd tersisa — belum perlu banner.
          } else if (delta > 0) {
            tone =
              "border-amber-400/40 bg-amber-500/10 text-amber-100";
            title = `Settlement deadline dalam ${delta} hari kerja`;
            body = `Deadline: ${dueLabel}. Segera submit nota + total pengeluaran supaya settlement diproses tepat waktu.`;
          } else if (delta === 0) {
            tone =
              "border-amber-500/60 bg-amber-500/20 text-amber-50";
            title = `Hari terakhir submit settlement`;
            body = `Hari ini (${dueLabel}) adalah hari kerja terakhir untuk submit settlement.`;
          } else {
            tone = "border-rose-500/50 bg-rose-500/15 text-rose-100";
            title = `Settlement lewat ${Math.abs(delta)} hari kerja`;
            body = `Deadline ${dueLabel} sudah terlewati. Mohon segera submit settlement — sistem akan mengeskalasi ke Supervisor/PM/OM sesuai jadwal reminder.`;
          }
          return (
            <div
              role="status"
              className={`rounded-2xl border ${tone} p-4 text-sm`}
            >
              <p className="font-semibold">{title}</p>
              <p className="mt-1 text-xs opacity-90">{body}</p>
            </div>
          );
        })()
      ) : null}

      {isCanonicalRow ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">{t("chainTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {canonicalChain.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("chainEmpty")}
              </p>
            ) : (
              <ApprovalChainProgress
                slots={canonicalChain}
                active={
                  CANONICAL_CA_STATUS_SLOT[status as CanonicalCaStatus] ?? null
                }
                variant="preview"
                size="sm"
                renderSlot={(slot) => tSlots(slot as CanonicalApprovalSlot)}
                data-testid="ca-detail-chain"
                ariaLabel="Cash advance approval chain"
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("requesterTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="font-semibold">{requester?.full_name ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {requester?.role
                ? formatRole(requester.role as EmployeeRole)
                : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("submittedAt", {
                date: formatInTz(ca.created_at, "dd MMM yyyy, HH:mm"),
              })}
            </p>
          </CardContent>
        </Card>

        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" /> {t("timelineTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ApprovalTimeline
              entries={logs}
              actionLabelMap={ACTION_LABEL}
              actionToneMap={ACTION_TONE}
              formatStatus={(status) =>
                caLabel(status as CashAdvanceStatus)
              }
              emptyLabel={t("timelineEmpty")}
              ariaLabel="Cash advance approval timeline"
              data-testid="ca-approval-timeline"
            />
          </CardContent>
        </Card>
      </div>

      <Card className="glass">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{tAttach("title")}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {caType === "FIELD_OPS"
                ? tAttach("subtitleFieldOps")
                : tAttach("subtitleGeneral")}
            </p>
          </div>
          {canEditAttachments ? (
            <UploadCashAdvanceAttachments cashAdvanceId={ca.id} />
          ) : (
            <span
              className="text-[11px] text-muted-foreground"
              title={tAttach("lockedTitle")}
            >
              {tAttach("locked")}
            </span>
          )}
        </CardHeader>
        <CardContent>
          <AttachedCashAdvanceFiles
            cashAdvanceId={ca.id}
            attachments={attachmentEntries}
            canDelete={canEditAttachments}
          />
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("settlementsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {settlements.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("settlementsEmpty")}
            </p>
          ) : (
            <ol className="divide-y divide-border/50">
              {settlements.map((s) => {
                const files = settlementAttachmentMap.get(s.id) ?? [];
                const canDetachOwn =
                  s.status === "SUBMITTED" && isRequester;
                return (
                  <li key={s.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={SETTLEMENT_TONE[s.status]}
                          >
                            {s.status}
                          </Badge>
                          <p className="text-sm">
                            {s.submitter?.full_name ?? "—"}
                          </p>
                        </div>
                        {s.notes ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {s.notes}
                          </p>
                        ) : null}
                        {s.return_reason ? (
                          <p className="mt-1 text-xs text-rose-400">
                            {t("returnedReason", { reason: s.return_reason })}
                          </p>
                        ) : null}
                        {canReviewSettlement && s.status === "SUBMITTED" ? (
                          <SettlementReviewButtons
                            settlementId={s.id}
                            flow={flow}
                          />
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">
                          {formatIDR(parseMoneyFromDb(s.total_spent))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatInTz(
                            s.submitted_at ?? s.accepted_at ?? new Date(),
                            "dd MMM, HH:mm",
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Nota/struk attached to this settlement submission */}
                    <SettlementAttachmentList
                      settlementId={s.id}
                      files={files}
                      canDetach={canDetachOwn}
                    />
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {netSettlement !== null ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle>{t("netSettlementTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular-nums font-semibold text-lg">
              {formatIDR(netSettlement)}
            </p>
            <p className="text-xs text-muted-foreground">
              {netSettlement > 0n
                ? t("netRefund")
                : netSettlement < 0n
                  ? t("netTopUp")
                  : t("netZero")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {ca.rejection_reason ? (
        <Card className="glass border border-rose-500/30">
          <CardHeader>
            <CardTitle className="text-rose-400">
              {t("rejectionReasonTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {ca.rejection_reason}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
