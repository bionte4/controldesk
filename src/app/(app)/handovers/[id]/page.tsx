import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatInTz } from "@/lib/format/date";
import { formatRole } from "@/lib/rbac/roles";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  PMH_STATUS_LABEL,
  PMH_STATUS_TONE,
  canApproveNextPmh,
} from "@/lib/handover/state";
import type { EmployeeRole } from "@/lib/rbac/roles";
import type {
  ApprovalAction,
  PmHandoverStatus,
} from "@/types/database";

import { HandoverActionButtons } from "../handover-action-buttons";

export const metadata: Metadata = { title: "Handover" };

type RawHandover = {
  id: string;
  status: PmHandoverStatus;
  effective_at: string;
  reason: string;
  handover_notes: string | null;
  created_at: string;
  om_approved_at: string | null;
  hm_approved_at: string | null;
  executed_at: string | null;
  rejection_reason: string | null;
  project: { id: string; code: string; name: string } | null;
  from_pm: { full_name: string; role: EmployeeRole } | null;
  to_pm: { full_name: string; role: EmployeeRole } | null;
  initiator: { full_name: string; role: EmployeeRole } | null;
};

type RawLog = {
  id: number;
  action: ApprovalAction;
  from_status: PmHandoverStatus;
  to_status: PmHandoverStatus;
  comment: string | null;
  created_at: string;
  actor_role: EmployeeRole | null;
  actor: { full_name: string } | null;
};

export default async function HandoverDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const [employee, t] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("handovers.detail"),
  ]);

  const supabase = await createClient();
  const { data: handoverRaw } = await supabase
    .from("pm_handovers")
    .select(
      "id, status, effective_at, reason, handover_notes, created_at, om_approved_at, hm_approved_at, executed_at, rejection_reason, project:project_id(id, code, name), from_pm:from_pm_employee_id(full_name, role), to_pm:to_pm_employee_id(full_name, role), initiator:initiated_by(full_name, role)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!handoverRaw) notFound();
  const h = handoverRaw as unknown as RawHandover;

  const { data: logsRaw } = await supabase
    .from("pm_handover_audit_logs")
    .select(
      "id, action, from_status, to_status, comment, created_at, actor_role, actor:actor_employee_id(full_name)",
    )
    .eq("handover_id", id)
    .order("created_at", { ascending: true });
  const logs = (logsRaw ?? []) as unknown as RawLog[];

  const canReviewApproval = canApproveNextPmh(
    employee.role as EmployeeRole,
    h.status,
  );
  const canExecute =
    h.status === "APPROVED" &&
    (
      [
        "OPERATIONS_MANAGER",
        "HEAD_MANAGER",
        "GENERAL_MANAGER",
        "TENANT_ADMIN",
      ] as readonly string[]
    ).includes(employee.role);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/handovers"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {h.project?.code ?? "—"} · {h.project?.name ?? "—"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("effectiveAt", {
                date: formatInTz(h.effective_at, "dd MMM yyyy, HH:mm"),
              })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={PMH_STATUS_TONE[h.status]}>
              {PMH_STATUS_LABEL[h.status]}
            </Badge>
            {canReviewApproval ? (
              <HandoverActionButtons id={h.id} mode="approve" />
            ) : null}
            {canExecute ? (
              <HandoverActionButtons id={h.id} mode="execute" />
            ) : null}
          </div>
        </div>
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">{t("transferTitle")}</CardTitle>
          <CardDescription>{t("transferDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-40">
              <p className="label-meta">{t("fromPm")}</p>
              <p className="font-medium">{h.from_pm?.full_name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                {h.from_pm ? formatRole(h.from_pm.role) : "—"}
              </p>
            </div>
            <ArrowRight className="size-5 text-muted-foreground" />
            <div className="flex-1 min-w-40">
              <p className="label-meta">{t("toPm")}</p>
              <p className="font-medium">{h.to_pm?.full_name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                {h.to_pm ? formatRole(h.to_pm.role) : "—"}
              </p>
            </div>
          </div>
          <Separator className="my-4" />
          <p className="label-meta">{t("reason")}</p>
          <p className="text-sm whitespace-pre-wrap">{h.reason}</p>
          {h.handover_notes ? (
            <>
              <p className="mt-4 label-meta">{t("notes")}</p>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {h.handover_notes}
              </p>
            </>
          ) : null}
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            {t("initiatedBy", {
              name: h.initiator?.full_name ?? "—",
              role: h.initiator ? formatRole(h.initiator.role) : "",
              date: formatInTz(h.created_at, "dd MMM yyyy, HH:mm"),
            })}
          </p>
        </CardContent>
      </Card>

      {h.rejection_reason ? (
        <Card className="glass border-rose-400/30">
          <CardHeader>
            <CardTitle className="text-base">
              {t("rejectionReasonTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{h.rejection_reason}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">{t("timelineTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("timelineEmpty")}
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className="flex items-start gap-3 border-l-2 border-primary/40 pl-3"
                >
                  <div className="flex-1">
                    <p className="text-sm">
                      <span className="font-medium">
                        {log.actor?.full_name ?? "—"}
                      </span>
                      {log.actor_role ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          · {formatRole(log.actor_role)}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {log.action} · {PMH_STATUS_LABEL[log.from_status]} →{" "}
                      {PMH_STATUS_LABEL[log.to_status]}
                    </p>
                    {log.comment ? (
                      <p className="mt-1 text-xs">{log.comment}</p>
                    ) : null}
                  </div>
                  <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatInTz(log.created_at, "dd MMM, HH:mm")}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
