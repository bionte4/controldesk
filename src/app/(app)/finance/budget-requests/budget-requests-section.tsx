import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApprovalChainProgress } from "@/components/approvals/approval-chain-progress";
import { formatInTz } from "@/lib/format/date";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { listBudgetRequestsByBudget } from "@/lib/budget-requests/data";
import {
  BR_STATUS_SLOT,
  brApprovalChain,
  brCanApprove,
  isBrPending,
} from "@/lib/budget-requests/state";
import {
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import type {
  BudgetRequestKind,
  BudgetRequestStatus,
} from "@/types/database";

import {
  BudgetRequestActionButtons,
  type BudgetRequestActionMode,
} from "./budget-request-actions";
import {
  NewBudgetRequestSheet,
  type BudgetDetailOption,
} from "./new-budget-request-sheet";

const STATUS_TONE: Record<BudgetRequestStatus, string> = {
  DRAFT: "border-slate-400/40 text-slate-400",
  PENDING_PM: "border-indigo-400/40 text-indigo-400",
  PENDING_FINANCE: "border-amber-400/40 text-amber-400",
  PENDING_DIRECTOR: "border-purple-400/40 text-purple-400",
  APPROVED: "border-emerald-400/40 text-emerald-400",
  APPLIED: "border-emerald-600/40 text-emerald-600",
  REJECTED: "border-rose-400/40 text-rose-400",
  CANCELLED: "border-slate-500/40 text-slate-500",
};

const KIND_TONE: Record<BudgetRequestKind, string> = {
  INCREASE: "border-emerald-400/40 text-emerald-400",
  DECREASE: "border-rose-400/40 text-rose-400",
  TRANSFER: "border-indigo-400/40 text-indigo-400",
};

function resolveActionMode(input: {
  status: BudgetRequestStatus;
  actorRole: CanonicalRole;
  actorEmployeeId: string;
  requesterId: string;
}): BudgetRequestActionMode {
  const { status, actorRole, actorEmployeeId, requesterId } = input;
  if (status === "APPROVED") {
    if (
      actorRole === "FINANCE" ||
      actorRole === "PM" ||
      actorRole === "OM" ||
      actorRole === "DIRECTOR" ||
      actorRole === "ADMIN"
    ) {
      return "apply";
    }
    return "none";
  }
  if (isBrPending(status)) {
    if (brCanApprove({ actorRole, current: status })) {
      return "approve+reject";
    }
    if (requesterId === actorEmployeeId) return "cancel";
    return "none";
  }
  if (status === "DRAFT" && requesterId === actorEmployeeId) return "cancel";
  return "none";
}

export async function BudgetRequestsSection({
  budgetId,
  details,
  actor,
}: {
  budgetId: string;
  details: BudgetDetailOption[];
  actor: {
    employeeId: string;
    role: AnyDbEmployeeRole;
  };
}) {
  const [t, tStatus, tKind, requests] = await Promise.all([
    getTranslations("budgetRequests"),
    getTranslations("budgetRequests.status"),
    getTranslations("budgetRequests.kind"),
    listBudgetRequestsByBudget(budgetId),
  ]);

  const canonicalRole = toCanonicalRole(actor.role);

  return (
    <Card className="glass" id="budget-requests">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base font-medium">{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </div>
        <NewBudgetRequestSheet budgetId={budgetId} details={details} />
      </CardHeader>
      <CardContent className="p-0">
        {requests.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <Th>{t("columns.kind")}</Th>
                  <Th className="text-right">{t("columns.amount")}</Th>
                  <Th>{t("columns.status")}</Th>
                  <Th>{t("columns.chain")}</Th>
                  <Th>{t("columns.requester")}</Th>
                  <Th>{t("columns.createdAt")}</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const amount = Number(parseMoneyFromDb(r.amount));
                  const chain = brApprovalChain(amount);
                  const activeSlot = BR_STATUS_SLOT[r.status];
                  const mode = resolveActionMode({
                    status: r.status,
                    actorRole: canonicalRole,
                    actorEmployeeId: actor.employeeId,
                    requesterId: r.requester_employee_id,
                  });
                  return (
                    <tr
                      key={r.id}
                      id={`br-${r.id}`}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={KIND_TONE[r.kind as BudgetRequestKind]}
                        >
                          {tKind(r.kind as BudgetRequestKind)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(BigInt(amount), { compact: true })}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[r.status]}
                        >
                          {tStatus(r.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <ApprovalChainProgress
                          slots={chain}
                          active={activeSlot}
                          ariaLabel={`Approval chain — ${r.status}`}
                        />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {r.requester?.full_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatInTz(r.created_at, "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <BudgetRequestActionButtons id={r.id} mode={mode} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`label-meta px-4 py-3 text-xs font-medium text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
