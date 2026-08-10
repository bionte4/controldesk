import type { Metadata } from "next";
import Link from "next/link";
import { FileClock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ApprovalChainProgress } from "@/components/approvals/approval-chain-progress";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import {
  isApproverRole,
  resolveEmployeeScope,
} from "@/lib/security/project-scope";
import {
  HR_CHAIN_SLOT_LABEL,
  HR_KIND_LABEL,
  HR_STATUS_LABEL,
  HR_STATUS_TONE,
  hrChainForKind,
  isHrTerminal,
} from "@/lib/hris/state";
import type { HrRequestKind, HrRequestStatus } from "@/types/database";

import { NewHrRequestSheet } from "./new-request-sheet";

export const metadata: Metadata = {
  title: "HR Requests",
};

type Row = {
  id: string;
  kind: HrRequestKind;
  status: HrRequestStatus;
  reason: string;
  start_at: string;
  end_at: string;
  created_at: string;
  requester_name: string;
};

type RawRow = {
  id: string;
  kind: HrRequestKind;
  status: HrRequestStatus;
  reason: string;
  start_at: string;
  end_at: string;
  created_at: string;
  requester: { full_name: string } | null;
};

async function loadRequests(
  caller: { id: string; role: AnyDbEmployeeRole },
): Promise<Row[]> {
  const supabase = await createClient();

  // HR requests are the most PII-sensitive list in the tenant
  // (leave/sick reasons, medical notes attached elsewhere). Rules
  // §3 requires strict need-to-know filtering:
  //   • Org roles (HR_ADMIN, ADMIN, DIRECTOR, GM, HM) — see all.
  //   • Approvers with a scope (SPV, PM, OM, FINANCE) — see own
  //     submissions + submissions from colleagues assigned to
  //     their projects (via `resolveEmployeeScope`, same set the
  //     employee directory uses).
  //   • Non-approvers (EMPLOYEE, PETTY_CASH_CUSTODIAN) — see
  //     only their own submissions, never someone else's leave.
  const scope = await resolveEmployeeScope(caller);
  const approver = isApproverRole(caller.role);

  let query = supabase
    .from("hr_requests")
    .select(
      "id, kind, status, reason, start_at, end_at, created_at, requester:requester_employee_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (scope.kind !== "org") {
    if (!approver) {
      query = query.eq("requester_employee_id", caller.id);
    } else if (scope.ids.length === 0) {
      // Approver with no reachable subordinates (freshly-onboarded
      // PM with no assignments yet) — degrade safely to self.
      query = query.eq("requester_employee_id", caller.id);
    } else {
      query = query.in("requester_employee_id", scope.ids);
    }
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const rows = data as unknown as RawRow[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    start_at: row.start_at,
    end_at: row.end_at,
    created_at: row.created_at,
    requester_name: row.requester?.full_name ?? "—",
  }));
}

export default async function HrRequestsPage() {
  const employee = await requireCurrentEmployee();
  const [rows, t, tKind] = await Promise.all([
    loadRequests({
      id: employee.id,
      role: employee.role as AnyDbEmployeeRole,
    }),
    getTranslations("hrRequests"),
    getTranslations("hrRequests.kinds"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("subtitle")}
          </p>
        </div>
        <NewHrRequestSheet />
      </header>

      {rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <FileClock className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("empty")}
            </CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>{t("columns.kind")}</Th>
                    <Th>{t("columns.requester")}</Th>
                    <Th>{t("columns.window")}</Th>
                    <Th>{t("columns.reason")}</Th>
                    <Th>{t("columns.status")}</Th>
                    <Th>{t("columns.chain")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const slots = hrChainForKind(r.kind);
                    const active = isHrTerminal(r.status) ? null : r.status;
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                          {tKind(r.kind)}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/hr/requests/${r.id}`}
                            className="hover:text-primary transition-colors"
                          >
                            {r.requester_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {formatInTz(r.start_at, "dd MMM, HH:mm")}
                          {" → "}
                          {formatInTz(r.end_at, "dd MMM, HH:mm")}
                        </td>
                        <td className="px-4 py-3 max-w-md truncate">
                          {r.reason}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={HR_STATUS_TONE[r.status]}
                          >
                            {HR_STATUS_LABEL[r.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <ApprovalChainProgress
                            slots={slots as unknown as string[]}
                            active={active}
                            variant="compact"
                            renderSlot={(slot) =>
                              HR_CHAIN_SLOT_LABEL[slot as HrRequestStatus] ??
                              slot
                            }
                            ariaLabel={`${tKind(r.kind)} approval chain`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="sr-only">{HR_KIND_LABEL.LEAVE}</p>
    </div>
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
