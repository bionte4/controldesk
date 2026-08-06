import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Receipt } from "lucide-react";
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
import { formatRole } from "@/lib/rbac/roles";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  STATUS_LABEL,
  STATUS_TONE,
  canApproveNext,
} from "@/lib/expenses/state";
import type {
  ApprovalAction,
  ExpenseStatus,
} from "@/types/database";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { ExpenseActionButtons } from "../expense-action-buttons";

export const metadata: Metadata = { title: "Expense" };

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

export default async function ExpenseDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const [employee, t] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("expenses.detail"),
  ]);

  const supabase = await createClient();

  type ExpenseView = {
    id: string;
    amount: string;
    description: string;
    incurred_on: string;
    receipt_url: string | null;
    status: ExpenseStatus;
    created_at: string;
    rejection_reason: string | null;
    projects: { id: string; code: string; name: string } | null;
    submitter: { id: string; full_name: string; role: string } | null;
  };
  type LogView = {
    id: number;
    action: ApprovalAction;
    actor_role: string | null;
    from_status: ExpenseStatus;
    to_status: ExpenseStatus;
    comment: string | null;
    created_at: string;
    actor: { full_name: string } | null;
  };

  const [{ data: expenseRaw }, { data: logsRaw }] = await Promise.all([
    supabase
      .from("project_expenses")
      .select(
        "*, projects(id, code, name), submitter:submitter_employee_id(id, full_name, role)",
      )
      .eq("id", id)
      .eq("tenant_id", employee.tenant_id)
      .maybeSingle(),
    supabase
      .from("expense_approval_logs")
      .select(
        "id, action, actor_role, from_status, to_status, comment, created_at, actor:actor_employee_id(full_name)",
      )
      .eq("expense_id", id)
      .eq("tenant_id", employee.tenant_id)
      .order("created_at", { ascending: true }),
  ]);

  if (!expenseRaw) notFound();

  const expense = expenseRaw as unknown as ExpenseView;
  const logs = (logsRaw ?? []) as unknown as LogView[];

  const status = expense.status;
  const project = expense.projects;
  const submitter = expense.submitter;
  const canAct = canApproveNext(employee.role as EmployeeRole, status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/finance/expenses" />}
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
        {canAct ? <ExpenseActionButtons id={expense.id} /> : null}
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Receipt className="size-6" />
          </div>
          <div>
            <p className="label-meta">
              {t("kicker")}
              {project ? (
                <>
                  <span className="ml-2 font-mono text-muted-foreground">
                    {project.code}
                  </span>
                </>
              ) : null}
            </p>
            <h1 className="font-display text-2xl font-semibold tracking-tight max-w-2xl">
              {expense.description}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={STATUS_TONE[status]}>
                {STATUS_LABEL[status]}
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
            {formatIDR(parseMoneyFromDb(expense.amount))}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("incurredOn", {
              date: formatInTz(expense.incurred_on, "dd MMM yyyy"),
            })}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("submitterTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="font-semibold">{submitter?.full_name ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {submitter?.role
                ? formatRole(submitter.role as EmployeeRole)
                : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("submittedAt", {
                date: formatInTz(expense.created_at, "dd MMM yyyy, HH:mm"),
              })}
            </p>
            {expense.receipt_url ? (
              <p className="pt-2">
                <a
                  href={expense.receipt_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-primary hover:underline"
                >
                  {t("openReceipt")}
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
                        {STATUS_LABEL[entry.from_status]}
                        {" → "}
                        {STATUS_LABEL[entry.to_status]}
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

      {expense.rejection_reason ? (
        <Card className="glass border border-rose-500/30">
          <CardHeader>
            <CardTitle className="text-rose-400">
              {t("rejectionReasonTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {expense.rejection_reason}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
