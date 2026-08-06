import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CircleX,
  TriangleAlert,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  getPortalProject,
  getPortalProjectFinance,
  listPortalMilestones,
  type PortalContractRow,
  type PortalMilestoneRow,
} from "@/lib/portal/data";
import { requirePortalSession } from "@/lib/portal/session";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import type { Tables } from "@/types/database";

export const metadata: Metadata = { title: "Portal — Project detail" };

type MilestoneStatus = Tables<"project_milestones">["status"];
type ProjectStatus = Tables<"projects">["status"];

const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  PLANNING: "border-white/10 bg-white/5 text-white/70",
  ACTIVE: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  ON_HOLD: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  COMPLETED: "border-indigo-400/30 bg-indigo-500/10 text-indigo-300",
  ARCHIVED: "border-white/10 bg-white/5 text-muted-foreground",
};

const MILESTONE_STATUS_TONE: Record<MilestoneStatus, string> = {
  PLANNED: "border-white/10 bg-white/5 text-muted-foreground",
  IN_PROGRESS: "border-indigo-400/30 bg-indigo-500/10 text-indigo-300",
  AT_RISK: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  DONE: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  CANCELLED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

const MILESTONE_STATUS_ICON: Record<
  MilestoneStatus,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  PLANNED: CircleDashed,
  IN_PROGRESS: CircleDot,
  AT_RISK: TriangleAlert,
  DONE: CheckCircle2,
  CANCELLED: CircleX,
};

export default async function PortalProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requirePortalSession();
  const [project, t, tStatus, tMilestone, tFin] = await Promise.all([
    getPortalProject(session, id),
    getTranslations("portal.projectDetail"),
    getTranslations("portal.projectStatus"),
    getTranslations("portal.milestoneStatus"),
    getTranslations("portal.projectFinance"),
  ]);

  // Cross-client isolation: if the project id doesn't resolve within
  // (tenant_id, client_id), `getPortalProject` returns null. We render a 404
  // instead of a "forbidden" error so we don't leak that the id exists.
  if (!project) notFound();

  const [milestones, finance] = await Promise.all([
    listPortalMilestones(session, id),
    getPortalProjectFinance(session, id),
  ]);
  const progressPct = Math.max(
    0,
    Math.min(100, Number(project.progress ?? 0)),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/portal/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {t("backToList")}
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            <span className="text-muted-foreground text-lg mr-2 tabular-nums">
              {project.code}
            </span>
            {project.name}
          </h1>
          {project.description ? (
            <p className="text-sm text-muted-foreground max-w-3xl mt-1">
              {project.description}
            </p>
          ) : null}
        </div>
        <Badge variant="outline" className={PROJECT_STATUS_TONE[project.status]}>
          {tStatus(project.status)}
        </Badge>
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-base">
            {t("summary.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{t("summary.progress")}</span>
              <span className="tabular-nums text-foreground">
                {progressPct}%
              </span>
            </div>
            <Progress value={progressPct} aria-label="Project progress" />
          </div>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <SummaryField
              label={t("summary.startDate")}
              value={project.start_date ?? "—"}
            />
            <SummaryField
              label={t("summary.endDate")}
              value={project.end_date ?? "—"}
            />
            <SummaryField
              label={t("summary.contractType")}
              value={project.project_type}
            />
          </dl>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-base">
            {t("milestones.title")}
          </CardTitle>
          <CardDescription>{t("milestones.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {milestones.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {t("milestones.empty")}
            </p>
          ) : (
            <ol className="relative ml-4 border-l border-border/50">
              {milestones.map((m) => (
                <MilestoneTimelineItem
                  key={m.id}
                  milestone={m}
                  statusLabel={tMilestone(m.status)}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {finance ? <FinanceSection finance={finance} tFin={tFin} /> : null}
    </div>
  );
}

function FinanceSection({
  finance,
  tFin,
}: {
  finance: NonNullable<Awaited<ReturnType<typeof getPortalProjectFinance>>>;
  tFin: Awaited<ReturnType<typeof getTranslations<"portal.projectFinance">>>;
}) {
  const budget = parseMoneyFromDb(finance.budget_amount);
  const spent = parseMoneyFromDb(finance.spent_amount);
  const remaining = budget - spent;
  const utilizationPct =
    budget > 0n ? Number((spent * 100n) / budget) : 0;
  const utilizationClamped = Math.max(0, Math.min(100, utilizationPct));
  const utilizationTone =
    utilizationClamped >= 90
      ? "border-rose-400/30 bg-rose-500/10 text-rose-300"
      : utilizationClamped >= 75
        ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
        : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300";

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="font-display text-base">
          {tFin("title")}
        </CardTitle>
        <CardDescription>{tFin("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {budget > 0n ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{tFin("budget.utilization")}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={utilizationTone}>
                  {tFin("budget.utilizationPct", {
                    pct: utilizationClamped.toFixed(1),
                  })}
                </Badge>
              </div>
            </div>
            <Progress
              value={utilizationClamped}
              aria-label={tFin("budget.utilization")}
              className="mt-2"
            />
            <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
              <FinanceStat
                label={tFin("budget.allocated")}
                value={formatIDR(budget)}
              />
              <FinanceStat
                label={tFin("budget.spent")}
                value={formatIDR(spent)}
              />
              <FinanceStat
                label={tFin("budget.remaining")}
                value={formatIDR(remaining)}
                tone={remaining < 0n ? "danger" : "default"}
              />
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {tFin("budget.empty")}
          </p>
        )}

        <div>
          <h3 className="text-sm font-medium mb-2">{tFin("contracts.title")}</h3>
          {finance.overlapping_contracts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {tFin("contracts.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/40">
              {finance.overlapping_contracts.map((c) => (
                <ContractRow
                  key={c.id}
                  contract={c}
                  activeLabel={tFin("contracts.active")}
                  draftLabel={tFin("contracts.draft")}
                  mrrLabel={tFin("contracts.mrr")}
                />
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            {tFin("privacyFootnote")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function FinanceStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div>
      <dt className="label-meta text-muted-foreground">{label}</dt>
      <dd
        className={
          tone === "danger"
            ? "mt-0.5 font-medium tabular-nums text-rose-300"
            : "mt-0.5 font-medium tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function ContractRow({
  contract,
  activeLabel,
  draftLabel,
  mrrLabel,
}: {
  contract: PortalContractRow;
  activeLabel: string;
  draftLabel: string;
  mrrLabel: string;
}) {
  const mrr = parseMoneyFromDb(contract.mrr_amount as unknown as string);
  const isActive = contract.status === "ACTIVE";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium truncate">{contract.contract_number}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {contract.start_date}
          {" → "}
          {contract.end_date ?? "…"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{mrrLabel}</span>
        <span className="font-medium tabular-nums">{formatIDR(mrr)}</span>
        <Badge
          variant="outline"
          className={
            isActive
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
              : "border-white/10 bg-white/5 text-muted-foreground"
          }
        >
          {isActive ? activeLabel : draftLabel}
        </Badge>
      </div>
    </li>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-meta text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function MilestoneTimelineItem({
  milestone,
  statusLabel,
}: {
  milestone: PortalMilestoneRow;
  statusLabel: string;
}) {
  const Icon = MILESTONE_STATUS_ICON[milestone.status];
  return (
    <li className="relative py-4 pl-6 pr-6">
      <span
        aria-hidden="true"
        className="absolute -left-3 top-5 grid size-6 place-items-center rounded-full border border-border bg-background"
      >
        <Icon className="size-3.5" aria-hidden={true} />
      </span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            <span className="text-muted-foreground text-xs mr-2 tabular-nums">
              {milestone.seq}.
            </span>
            {milestone.name}
          </p>
          {milestone.description ? (
            <p className="text-xs text-muted-foreground max-w-2xl">
              {milestone.description}
            </p>
          ) : null}
        </div>
        <Badge
          variant="outline"
          className={MILESTONE_STATUS_TONE[milestone.status]}
        >
          {statusLabel}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <CalendarDays aria-hidden="true" className="size-3.5" />
          {milestone.planned_start_date ?? "—"}
          {" → "}
          {milestone.planned_end_date ?? "—"}
        </span>
        <span className="tabular-nums">
          {(milestone.weight_bps / 100).toFixed(2)}%
        </span>
      </div>
    </li>
  );
}
