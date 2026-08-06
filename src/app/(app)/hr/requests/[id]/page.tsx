import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, FileClock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ApprovalChainProgress } from "@/components/approvals/approval-chain-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { formatRole } from "@/lib/rbac/roles";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  HR_CHAIN_SLOT_LABEL,
  HR_STATUS_LABEL,
  HR_STATUS_TONE,
  canApproveNextHr,
  hrChainForKind,
  isHrTerminal,
} from "@/lib/hris/state";
import type { EmployeeRole } from "@/lib/rbac/roles";
import type {
  ApprovalAction,
  HrRequestKind,
  HrRequestStatus,
} from "@/types/database";

import { HrActionButtons } from "../hr-action-buttons";

export const metadata: Metadata = { title: "HR Request" };

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

export default async function HrRequestDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const [employee, t, tKind] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("hrRequests.detail"),
    getTranslations("hrRequests.kinds"),
  ]);

  const supabase = await createClient();

  type RequestView = {
    id: string;
    kind: HrRequestKind;
    leave_type: string | null;
    start_at: string;
    end_at: string;
    hours_estimate: string | null;
    reason: string;
    attachment_url: string | null;
    status: HrRequestStatus;
    created_at: string;
    rejection_reason: string | null;
    requester: { full_name: string; role: string } | null;
  };
  type LogView = {
    id: number;
    action: ApprovalAction;
    actor_role: string | null;
    from_status: HrRequestStatus;
    to_status: HrRequestStatus;
    comment: string | null;
    created_at: string;
    actor: { full_name: string } | null;
  };

  const [{ data: requestRaw }, { data: logsRaw }] = await Promise.all([
    supabase
      .from("hr_requests")
      .select(
        "*, requester:requester_employee_id(full_name, role)",
      )
      .eq("id", id)
      .eq("tenant_id", employee.tenant_id)
      .maybeSingle(),
    supabase
      .from("hr_approval_logs")
      .select(
        "id, action, actor_role, from_status, to_status, comment, created_at, actor:actor_employee_id(full_name)",
      )
      .eq("request_id", id)
      .eq("tenant_id", employee.tenant_id)
      .order("created_at", { ascending: true }),
  ]);

  if (!requestRaw) notFound();

  const req = requestRaw as unknown as RequestView;
  const logs = (logsRaw ?? []) as unknown as LogView[];

  const canAct = canApproveNextHr(employee.role as EmployeeRole, req.status);

  const chainSlots = hrChainForKind(req.kind);
  const chainActive = isHrTerminal(req.status) ? null : req.status;
  const chainCompleted = (() => {
    if (req.status === "APPROVED") return [...chainSlots];
    // REJECTED / CANCELLED → keep the historical "completed" steps derived
    // from the log (best-effort: all slots strictly before the last
    // pending state before rejection).
    const rejectFromStatus = logs.find(
      (l) => l.action === "REJECT" || l.action === "FINANCE_REJECT",
    )?.from_status;
    if (rejectFromStatus) {
      const completed: HrRequestStatus[] = [];
      for (const slot of chainSlots) {
        if (slot === rejectFromStatus) break;
        completed.push(slot);
      }
      return completed;
    }
    return undefined;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/hr/requests" />}
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
        {canAct ? <HrActionButtons id={req.id} /> : null}
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FileClock className="size-6" />
          </div>
          <div>
            <p className="label-meta">
              {t("kicker")}
              <span className="ml-2 font-mono text-muted-foreground uppercase">
                {tKind(req.kind)}
              </span>
            </p>
            <h1 className="font-display text-2xl font-semibold tracking-tight max-w-2xl">
              {req.reason}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={HR_STATUS_TONE[req.status]}>
                {HR_STATUS_LABEL[req.status]}
              </Badge>
              {req.leave_type ? (
                <Badge variant="outline">{req.leave_type}</Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="label-meta">{t("window")}</p>
          <p className="font-display text-lg font-semibold tabular-nums">
            {formatInTz(req.start_at, "dd MMM, HH:mm")}
            {" → "}
            {formatInTz(req.end_at, "dd MMM, HH:mm")}
          </p>
          {req.hours_estimate ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("hours", { hours: req.hours_estimate })}
            </p>
          ) : null}
        </div>
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("approvalChainTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ApprovalChainProgress
            slots={chainSlots as unknown as string[]}
            active={chainActive}
            completed={chainCompleted as unknown as string[] | undefined}
            variant="preview"
            size="sm"
            renderSlot={(slot) =>
              HR_CHAIN_SLOT_LABEL[slot as HrRequestStatus] ?? slot
            }
            ariaLabel={t("approvalChainTitle")}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("requesterTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="font-semibold">{req.requester?.full_name ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {req.requester?.role
                ? formatRole(req.requester.role as EmployeeRole)
                : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("submittedAt", {
                date: formatInTz(req.created_at, "dd MMM yyyy, HH:mm"),
              })}
            </p>
            {req.attachment_url ? (
              <p className="pt-2">
                <a
                  href={req.attachment_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-primary hover:underline"
                >
                  {t("openAttachment")}
                </a>
              </p>
            ) : null}
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
                        {HR_STATUS_LABEL[entry.from_status]}
                        {" → "}
                        {HR_STATUS_LABEL[entry.to_status]}
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

      {req.rejection_reason ? (
        <Card className="glass border border-rose-500/30">
          <CardHeader>
            <CardTitle className="text-rose-400">
              {t("rejectionReasonTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {req.rejection_reason}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
