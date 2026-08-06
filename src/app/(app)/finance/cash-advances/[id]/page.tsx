import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, Wallet } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
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
  CANONICAL_CA_STATUS_TONE,
  caCanonicalChain,
  canonicalCaCanApprove,
  isCanonicalCaStatus,
} from "@/lib/cash-advance/state-canonical";
import type { EmployeeRole } from "@/lib/rbac/roles";
import type {
  ApprovalAction,
  CashAdvanceStatus,
  CashAdvanceSettlementStatus,
  CashAdvanceType,
} from "@/types/database";

import { CashAdvanceActionButtons } from "../cash-advance-action-buttons";
import { SubmitSettlementDialog } from "../settlement-panel";
import { SettlementReviewButtons } from "../settlement-review-buttons";

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

  const [employee, t, tSlots] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("cashAdvances.detail"),
    getTranslations("cashAdvances.chainSlot"),
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
    requester_employee_id: string;
    project_id: string;
    projects: { id: string; code: string; name: string } | null;
    requester: { id: string; full_name: string; role: string } | null;
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
          "*, projects(id, code, name), requester:requester_employee_id(id, full_name, role)",
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
            <SubmitSettlementDialog cashAdvanceId={ca.id} flow={flow} />
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
              <Badge variant="outline" className={caTone(status)}>
                {caLabel(status)}
              </Badge>
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
        </div>
      </header>

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
              <ol
                className="flex flex-wrap items-center gap-2"
                data-testid="ca-detail-chain"
              >
                {canonicalChain.map((slot, idx) => (
                  <li
                    key={`${slot}-${idx}`}
                    className="flex items-center gap-2"
                  >
                    <Badge
                      variant="outline"
                      className="border-primary/30 bg-primary/5 text-primary"
                    >
                      {tSlots(slot)}
                    </Badge>
                    {idx < canonicalChain.length - 1 ? (
                      <ArrowRight className="size-3 text-muted-foreground" />
                    ) : null}
                  </li>
                ))}
              </ol>
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
            {logs.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {t("timelineEmpty")}
              </p>
            ) : (
              <ol className="relative divide-y divide-border/50">
                {logs.map((entry) => (
                  <li
                    key={entry.id}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3"
                  >
                    <Badge
                      variant="outline"
                      className={ACTION_TONE[entry.action]}
                    >
                      {ACTION_LABEL[entry.action]}
                    </Badge>
                    <div>
                      <p className="text-sm">
                        <span className="font-medium">
                          {entry.actor?.full_name ?? "System"}
                        </span>{" "}
                        {entry.actor_role ? (
                          <span className="text-xs text-muted-foreground">
                            · {formatRole(entry.actor_role as EmployeeRole)}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {caLabel(entry.from_status)}
                        {" → "}
                        {caLabel(entry.to_status)}
                      </p>
                      {entry.comment ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          “{entry.comment}”
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatInTz(entry.created_at, "dd MMM, HH:mm")}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

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
              {settlements.map((s) => (
                <li
                  key={s.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={SETTLEMENT_TONE[s.status]}>
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
                </li>
              ))}
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
