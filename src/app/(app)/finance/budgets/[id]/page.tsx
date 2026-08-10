import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BadgeDollarSign } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { NextActionHint } from "@/components/approvals/next-action-hint";
import { FinanceStatusBadge } from "@/components/finance/finance-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatInTz } from "@/lib/format/date";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { loadPostableAccounts } from "@/lib/data/coa";
import { loadLookupOptions } from "@/lib/data/lookups";
import {
  BUDGET_VIEWER_ROLES,
  toCanonicalRole,
  type AnyDbEmployeeRole,
} from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import {
  BUDGET_STATUS_LABEL,
  BUDGET_STATUS_TONE,
  budgetSlotForStatus,
  canBudgetAdvance,
} from "@/lib/budgets/state";
import { BUDGET_CATEGORIES } from "@/lib/validation/budget";
import type { BudgetStatus } from "@/types/database";

import {
  BudgetActionButtons,
  type BudgetActionMode,
} from "../budget-action-buttons";
import {
  AddBudgetLineItem,
  DeleteBudgetLineItemButton,
} from "../budget-line-item-form";
import { BudgetRequestsSection } from "../../budget-requests/budget-requests-section";
import type { BudgetDetailOption } from "../../budget-requests/new-budget-request-sheet";

export const metadata: Metadata = { title: "Budget" };

type BudgetDetail = {
  id: string;
  tenant_id: string;
  project_id: string;
  fiscal_year: number;
  title: string;
  currency: string;
  status: BudgetStatus;
  total_planned_amount_db: string | number;
  notes: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  project_code: string;
  project_name: string;
};

type BudgetLine = {
  id: string;
  seq: number;
  category: string;
  coa_id: string | null;
  description: string | null;
  planned_amount_db: string | number;
  realized_amount_db: string | number;
  outstanding_amount_db: string | number;
  remaining_amount_db: string | number | null;
};

async function loadBudget(id: string): Promise<BudgetDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budgets")
    .select(
      `id, tenant_id, project_id, fiscal_year, title, currency, status,
       total_planned_amount, notes, approved_at, created_by, created_at,
       projects(code, name),
       creator:employees!budgets_created_by_fkey(full_name),
       approver:employees!budgets_approved_by_fkey(full_name)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const proj = data.projects as unknown as { code: string; name: string } | null;
  const creator = data.creator as unknown as { full_name: string } | null;
  const approver = data.approver as unknown as { full_name: string } | null;

  return {
    id: data.id,
    tenant_id: data.tenant_id,
    project_id: data.project_id,
    fiscal_year: data.fiscal_year,
    title: data.title,
    currency: data.currency,
    status: data.status as BudgetStatus,
    total_planned_amount_db: data.total_planned_amount,
    notes: data.notes,
    approved_at: data.approved_at,
    approved_by_name: approver?.full_name ?? null,
    created_by: data.created_by,
    created_by_name: creator?.full_name ?? null,
    created_at: data.created_at,
    project_code: proj?.code ?? "—",
    project_name: proj?.name ?? "—",
  };
}

async function loadLines(budgetId: string): Promise<BudgetLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budget_details")
    .select(
      "id, seq, category, coa_id, description, planned_amount, realized_amount, outstanding_amount, remaining_amount",
    )
    .eq("budget_id", budgetId)
    .order("seq", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    seq: row.seq,
    category: row.category,
    coa_id: row.coa_id,
    description: row.description,
    planned_amount_db: row.planned_amount,
    realized_amount_db: row.realized_amount,
    outstanding_amount_db: row.outstanding_amount,
    remaining_amount_db: row.remaining_amount,
  }));
}

function resolveAction(
  status: BudgetStatus,
  actorCanonicalRole: ReturnType<typeof toCanonicalRole>,
  actorEmployeeId: string,
  createdBy: string | null,
): BudgetActionMode {
  if (status === "APPROVED" || status === "CANCELLED") return "none";

  if (status === "DRAFT" || status === "REVISED") {
    // Only the submitter (or ADMIN) can submit / cancel while it's still open.
    const isOwner = createdBy === actorEmployeeId;
    if (isOwner || actorCanonicalRole === "ADMIN") return "submit";
    return "none";
  }

  // Pending — decide by slot.
  if (canBudgetAdvance(actorCanonicalRole, status)) {
    return "approve+reject";
  }
  // Owner can still cancel in flight.
  if (createdBy === actorEmployeeId) return "cancel";
  return "none";
}

/**
 * Best-effort label resolution for legacy budget categories persisted with
 * enum-shaped codes (`DIRECT_LABOUR`, `OPERATIONS`, …). If the code is one
 * of the seeded defaults we route through the strict-typed i18n bundle;
 * otherwise we render the raw code so admin-defined codes (added post-0054)
 * still display when the lookup map doesn't hit.
 */
function resolveLegacyCategoryLabel(
  code: string,
  // next-intl's translator has a strict keyof namespace parameter; typing
  // it here as an untyped callable keeps our runtime fallback compile-clean
  // without polluting the caller with cast noise.
  tCat: (key: never) => string,
): string {
  if ((BUDGET_CATEGORIES as readonly string[]).includes(code)) {
    try {
      return tCat(code as never);
    } catch {
      return code;
    }
  }
  return code;
}

export default async function BudgetDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const employee = await requireCurrentEmployee();
  if (!BUDGET_VIEWER_ROLES.includes(employee.role)) {
    redirect("/dashboard?error=forbidden");
  }

  const [
    budget,
    lines,
    t,
    tCat,
    tHint,
    tSlots,
    budgetCategoryLookup,
    coaAccounts,
  ] = await Promise.all([
    loadBudget(id),
    loadLines(id),
    getTranslations("budgets.detail"),
    getTranslations("budgets.categories"),
    getTranslations("approvals.nextAction"),
    getTranslations("cashAdvances.chainSlot"),
    loadLookupOptions("budget_category"),
    loadPostableAccounts(),
  ]);
  if (!budget) notFound();

  // Build a label lookup keyed by code so both the read-only cell and the
  // "Add line item" form can prefer the admin-curated label over the fixed
  // i18n bundle. New admin-added codes (e.g. SOFTWARE_LICENSE) resolve via
  // this map; legacy seeded codes still fall back to `tCat` if the lookup
  // was never touched.
  const categoryLabelByCode = new Map<string, string>(
    budgetCategoryLookup.map((row) => [row.code, row.label]),
  );
  const categoryOptions = budgetCategoryLookup.map((row) => ({
    code: row.code,
    label: row.label,
  }));

  // CoA render helpers — dropdown feeds the form, label map feeds the
  // read-only table. Kept side by side so both stay in sync.
  const coaOptions = coaAccounts.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
  }));
  const coaById = new Map(coaAccounts.map((r) => [r.id, r]));

  const totalPlanned = parseMoneyFromDb(budget.total_planned_amount_db);
  const totalRealized = lines.reduce(
    (acc, l) => acc + parseMoneyFromDb(l.realized_amount_db),
    0n,
  );
  const totalOutstanding = lines.reduce(
    (acc, l) => acc + parseMoneyFromDb(l.outstanding_amount_db),
    0n,
  );
  const totalRemaining = lines.reduce(
    (acc, l) => acc + parseMoneyFromDb(l.remaining_amount_db),
    0n,
  );

  const utilizationPct =
    totalPlanned > 0n
      ? Number(((totalRealized + totalOutstanding) * 10000n) / totalPlanned) / 100
      : 0;

  const canonicalRole = toCanonicalRole(employee.role as AnyDbEmployeeRole);
  const actionMode = resolveAction(
    budget.status,
    canonicalRole,
    employee.id,
    budget.created_by,
  );

  const readOnly = budget.status === "APPROVED" || budget.status === "CANCELLED";
  const pendingSlot = budgetSlotForStatus(budget.status);
  const nextSeq = lines.reduce((max, l) => Math.max(max, l.seq), 0) + 1;

  // Workflow hint — Budget has no REJECTED terminal (uses REVISED to bounce
  // back to submitter), so we treat REVISED as "info + returned to owner" and
  // wire APPROVED/CANCELLED per rules §9.
  const canActNow = canBudgetAdvance(canonicalRole, budget.status);
  const budgetHint: {
    intent: "pending" | "approved" | "rejected" | "cancelled" | "info";
    title: string;
    description: string;
  } | null = (() => {
    if (budget.status === "DRAFT") {
      return {
        intent: "info",
        title: tHint("draftTitle"),
        description: tHint("draftDescription"),
      };
    }
    if (budget.status === "APPROVED") {
      return {
        intent: "approved",
        title: tHint("approvedTitle"),
        description: tHint("approvedDescription"),
      };
    }
    if (budget.status === "CANCELLED") {
      return {
        intent: "cancelled",
        title: tHint("cancelledTitle"),
        description: tHint("cancelledDescription"),
      };
    }
    if (budget.status === "REVISED") {
      return {
        intent: "info",
        title: tHint("returnedTitle"),
        description: tHint("returnedDescription"),
      };
    }
    if (pendingSlot) {
      const slotLabel = tSlots(pendingSlot);
      return {
        intent: "pending",
        title: tHint("pendingTitle", { slot: slotLabel }),
        description: canActNow
          ? tHint("pendingSelfDescription")
          : tHint("pendingDescription", { slot: slotLabel }),
      };
    }
    return null;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/finance/budgets" />}
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <p className="label-meta">{t("kicker")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {budget.title}
            </h1>
            <FinanceStatusBadge
              tone={BUDGET_STATUS_TONE[budget.status]}
              label={BUDGET_STATUS_LABEL[budget.status]}
              data-testid="budget-status-badge"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/projects/${budget.project_id}`}
              className="hover:text-primary transition-colors"
            >
              {budget.project_code} · {budget.project_name}
            </Link>{" "}
            · FY{budget.fiscal_year} · {budget.currency}
          </p>
          {pendingSlot ? (
            <p className="text-xs text-muted-foreground">
              {t("awaiting", { slot: pendingSlot })}
            </p>
          ) : null}
        </div>
        <BudgetActionButtons id={budget.id} mode={actionMode} />
      </header>

      {budgetHint ? (
        <NextActionHint
          intent={budgetHint.intent}
          title={budgetHint.title}
          description={budgetHint.description}
          data-testid="budget-next-action-hint"
        />
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryTile
          label={t("totalPlanned")}
          value={formatIDR(totalPlanned)}
          accent="text-foreground"
        />
        <SummaryTile
          label={t("totalRealized")}
          value={formatIDR(totalRealized)}
          accent="text-emerald-500 dark:text-emerald-400"
        />
        <SummaryTile
          label={t("totalOutstanding")}
          value={formatIDR(totalOutstanding)}
          accent="text-amber-500 dark:text-amber-400"
        />
        <SummaryTile
          label={t("totalRemaining")}
          value={formatIDR(totalRemaining)}
          accent={
            totalRemaining < 0n
              ? "text-rose-500 dark:text-rose-400"
              : "text-indigo-500 dark:text-indigo-400"
          }
        />
      </section>

      <Card className="glass">
        <CardHeader className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <BadgeDollarSign className="size-4 text-primary" />
            {t("utilizationTitle")}
          </CardTitle>
          <CardDescription>
            {t("utilizationSubtitle", {
              percent: utilizationPct.toFixed(1),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={Math.min(100, utilizationPct)} className="h-2" />
        </CardContent>
      </Card>

      <Card className="glass overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium">
              {t("lineItemsTitle")}
            </CardTitle>
            <CardDescription>{t("lineItemsSubtitle")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              {t("noLineItems")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>#</Th>
                    <Th>{t("columns.category")}</Th>
                    <Th>{t("columns.coa")}</Th>
                    <Th>{t("columns.description")}</Th>
                    <Th className="text-right">{t("columns.planned")}</Th>
                    <Th className="text-right">{t("columns.realized")}</Th>
                    <Th className="text-right">{t("columns.outstanding")}</Th>
                    <Th className="text-right">{t("columns.remaining")}</Th>
                    <Th className="w-8">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr
                      key={l.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {l.seq}
                      </td>
                      <td className="px-4 py-3">
                        {categoryLabelByCode.get(l.category) ??
                          resolveLegacyCategoryLabel(l.category, tCat)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {l.coa_id && coaById.has(l.coa_id) ? (
                          <span>
                            <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]">
                              {coaById.get(l.coa_id)!.code}
                            </code>{" "}
                            <span className="text-muted-foreground">
                              {coaById.get(l.coa_id)!.name}
                            </span>
                          </span>
                        ) : (
                          // Empty CoA is a soft warning — the row is
                          // legal (nullable per migration 0056), but
                          // Finance can't post it to GL until a MA is
                          // set. Render an amber badge so approvers
                          // see it before the budget is locked.
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            title={t("coaMissingHelp")}
                          >
                            {t("coaMissing")}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {l.description ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(parseMoneyFromDb(l.planned_amount_db), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-500 dark:text-emerald-400">
                        {formatIDR(parseMoneyFromDb(l.realized_amount_db), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-500 dark:text-amber-400">
                        {formatIDR(
                          parseMoneyFromDb(l.outstanding_amount_db),
                          { compact: true },
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(parseMoneyFromDb(l.remaining_amount_db), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeleteBudgetLineItemButton
                          id={l.id}
                          readOnly={readOnly}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!readOnly ? (
            <div className="border-t border-border/50 p-4">
              <AddBudgetLineItem
                budgetId={budget.id}
                nextSeq={nextSeq}
                readOnly={readOnly}
                categoryOptions={categoryOptions}
                coaOptions={coaOptions}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {budget.status === "APPROVED" ? (
        <BudgetRequestsSection
          budgetId={budget.id}
          details={lines.map<BudgetDetailOption>((l) => ({
            id: l.id,
            seq: l.seq,
            category: l.category,
            remaining_idr: Number(parseMoneyFromDb(l.remaining_amount_db)),
          }))}
          actor={{
            employeeId: employee.id,
            role: employee.role as AnyDbEmployeeRole,
          }}
        />
      ) : null}

      <Card className="glass">
        <CardHeader className="flex flex-col gap-1">
          <CardTitle className="text-base font-medium">
            {t("metadataTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <MetadataRow
            label={t("createdBy")}
            value={budget.created_by_name ?? "—"}
          />
          <MetadataRow
            label={t("createdAt")}
            value={formatInTz(budget.created_at, "dd MMM yyyy, HH:mm")}
          />
          {budget.approved_at ? (
            <MetadataRow
              label={t("approvedBy")}
              value={budget.approved_by_name ?? "—"}
            />
          ) : null}
          {budget.approved_at ? (
            <MetadataRow
              label={t("approvedAt")}
              value={formatInTz(budget.approved_at, "dd MMM yyyy, HH:mm")}
            />
          ) : null}
          {budget.notes ? (
            <div className="md:col-span-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs whitespace-pre-wrap">
              <p className="label-meta mb-1">{t("notes")}</p>
              <p className="font-mono text-muted-foreground">{budget.notes}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card className="glass">
      <CardContent className="p-4">
        <p className="label-meta">{label}</p>
        <p className={`mt-1 font-display text-xl tabular-nums ${accent}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="label-meta">{label}</p>
      <p className="tabular-nums text-right text-muted-foreground">{value}</p>
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
