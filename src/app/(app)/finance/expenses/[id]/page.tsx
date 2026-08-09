import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { FinanceStatusBadge } from "@/components/finance/finance-status-badge";
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
import { listAttachmentsSigned } from "@/lib/attachments";
import {
  STATUS_LABEL,
  STATUS_TONE,
  canApproveNext,
} from "@/lib/expenses/state";
import type {
  ApprovalAction,
  ExpensePaymentMethod,
  ExpenseStatus,
} from "@/types/database";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { ExpenseActionButtons } from "../expense-action-buttons";
import {
  AssignBudgetLine,
  AttachedReceipts,
  DeleteDraftButton,
  SubmitDraftButton,
  UploadReceipts,
  type ReceiptEntry,
} from "../draft-widgets";

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
    notes: string | null;
    incurred_on: string;
    receipt_url: string | null;
    status: ExpenseStatus;
    created_at: string;
    rejection_reason: string | null;
    payment_method: ExpensePaymentMethod | null;
    submitter_employee_id: string;
    budget_detail_id: string | null;
    coa_id: string | null;
    projects: { id: string; code: string; name: string } | null;
    submitter: { id: string; full_name: string; role: string } | null;
    budget_detail: {
      id: string;
      code: string | null;
      seq: number;
      category: string;
    } | null;
    coa: {
      id: string;
      code: string;
      name: string;
    } | null;
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
        "*, projects(id, code, name), submitter:submitter_employee_id(id, full_name, role), budget_detail:budget_detail_id(id, code, seq, category), coa:coa_id(id, code, name)",
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

  const isDraft = status === "DRAFT";
  const isSubmitter = expense.submitter_employee_id === employee.id;
  const canEditReceipts =
    isSubmitter && (isDraft || status === "PENDING_L1_SUPERVISOR");

  const receiptRows = await listAttachmentsSigned(
    "project_expense",
    expense.id,
  );
  const receipts: ReceiptEntry[] = receiptRows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime_type: r.mime_type,
    size_bytes: r.size_bytes,
    signed_url: r.signed_url,
  }));

  // MA (budget line) is intentionally NOT part of the submitter's readiness
  // gate — approvers (PM/Finance) classify it during review. Payment method
  // + at least one receipt are still hard prerequisites so the reviewer has
  // enough evidence to code and approve.
  const submitLocked = !expense.payment_method || receipts.length === 0;
  const submitLockedReason = submitLocked ? t("submitLocked") : undefined;

  // Trusted approvers may (re)assign the budget line on any non-terminal
  // expense. Aligns with `decideMoneyRequest` PDP branch (§9).
  const MA_EDITOR_ROLES: readonly EmployeeRole[] = [
    "PROJECT_MANAGER",
    "LEAD_FINANCE",
    "OPERATIONS_MANAGER",
    "HEAD_MANAGER",
    "GENERAL_MANAGER",
    "TENANT_ADMIN",
  ];
  const NON_TERMINAL_STATES: readonly ExpenseStatus[] = [
    "DRAFT",
    "PENDING_L1_SUPERVISOR",
    "PENDING_L2_PROJECT_MANAGER",
    "PENDING_L2_5_FINANCE",
    "PENDING_L3_OPERATIONS_MANAGER",
    "PENDING_L4_HEAD_MANAGER",
    "PENDING_L5_GENERAL_MANAGER",
  ];
  const canAssignBudgetLine =
    MA_EDITOR_ROLES.includes(employee.role as EmployeeRole) &&
    NON_TERMINAL_STATES.includes(status) &&
    Boolean(project);

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
        <div className="flex flex-wrap items-center gap-2">
          {isDraft && isSubmitter ? (
            <>
              <DeleteDraftButton expenseId={expense.id} />
              <SubmitDraftButton
                expenseId={expense.id}
                disabled={submitLocked}
                lockedReason={submitLockedReason}
              />
            </>
          ) : null}
          {canAct ? <ExpenseActionButtons id={expense.id} /> : null}
        </div>
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
              <FinanceStatusBadge
                tone={STATUS_TONE[status]}
                label={STATUS_LABEL[status]}
                data-testid="expense-status-badge"
              />
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
            <div className="mt-3 grid gap-1.5 border-t border-border/40 pt-3 text-xs">
              {expense.budget_detail ? (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t("budgetLineLabel")}
                  </span>
                  <span className="text-right font-medium">
                    {expense.budget_detail.code ??
                      `#${expense.budget_detail.seq}`}{" "}
                    · {expense.budget_detail.category}
                  </span>
                </div>
              ) : null}
              {expense.coa ? (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t("coaLabel")}
                  </span>
                  <span className="text-right font-medium">
                    {expense.coa.code} · {expense.coa.name}
                  </span>
                </div>
              ) : null}
              {expense.payment_method ? (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t("paymentMethodLabel")}
                  </span>
                  <span className="text-right font-medium">
                    {expense.payment_method
                      .toLowerCase()
                      .split("_")
                      .map((s) => s[0].toUpperCase() + s.slice(1))
                      .join(" ")}
                  </span>
                </div>
              ) : null}
            </div>
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
            <ApprovalTimeline
              entries={logs}
              actionLabelMap={ACTION_LABEL}
              actionToneMap={ACTION_TONE}
              formatStatus={(status) =>
                STATUS_LABEL[status as ExpenseStatus] ?? status
              }
              emptyLabel={t("timelineEmpty")}
              ariaLabel="Expense approval timeline"
              data-testid="expense-approval-timeline"
            />
          </CardContent>
        </Card>
      </div>

      {canAssignBudgetLine && project ? (
        <AssignBudgetLine
          expenseId={expense.id}
          projectId={project.id}
          currentBudgetDetailId={expense.budget_detail_id}
          currentLabel={
            expense.budget_detail
              ? `${
                  expense.budget_detail.code ??
                  `#${expense.budget_detail.seq}`
                } · ${expense.budget_detail.category}`
              : null
          }
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("receiptsTitle")}</CardTitle>
            {canEditReceipts ? (
              <UploadReceipts expenseId={expense.id} />
            ) : null}
          </CardHeader>
          <CardContent>
            <AttachedReceipts
              expenseId={expense.id}
              receipts={receipts}
              canDelete={canEditReceipts}
            />
          </CardContent>
        </Card>

        {expense.notes ? (
          <Card className="glass lg:col-span-1">
            <CardHeader>
              <CardTitle>{t("notesTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {expense.notes}
              </p>
            </CardContent>
          </Card>
        ) : null}
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
