import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatIDR } from "@/lib/format/money";
import { cn } from "@/lib/utils";

import type { PortfolioSnapshot, PortfolioTile } from "./actions";

type Labels = {
  section: {
    title: string;
    subtitle: string;
    empty: string;
    emptyBody: string;
  };
  totals: {
    activeProjects: string;
    totalPlanned: string;
    totalRealised: string;
    totalOutstanding: string;
    averageProgress: string;
  };
  ring: { progress: string; budget: string };
  labels: {
    client: string;
    noBudget: string;
    planned: string;
    realised: string;
    outstanding: string;
    utilisation: string;
    milestones: string;
    over: string;
    onTrack: string;
  };
};

/**
 * Executive portfolio tiles (rules §5, §8 client dashboard). Renders one
 * card per active project surfacing:
 *   - Milestone progress ring (green when ≥ 80%, amber 40-79%, primary
 *     < 40%).
 *   - Budget utilisation ring (rose when > 100%, amber 80-100%, green
 *     ≤ 80%; grey outline when no budget yet).
 *
 * Server component only — no framer motion, no client hooks. Rings are
 * pure SVG so they stream with the RSC payload without adding to the
 * client bundle.
 */
export async function PortfolioSnapshotSection({
  snapshot,
}: {
  snapshot: PortfolioSnapshot;
}) {
  const [t, tTotals, tRing, tLabels] = await Promise.all([
    getTranslations("dashboard.portfolio"),
    getTranslations("dashboard.portfolio.totals"),
    getTranslations("dashboard.portfolio.ring"),
    getTranslations("dashboard.portfolio.labels"),
  ]);

  const labels: Labels = {
    section: {
      title: t("title"),
      subtitle: t("subtitle"),
      empty: t("empty"),
      emptyBody: t("emptyBody"),
    },
    totals: {
      activeProjects: tTotals("activeProjects"),
      totalPlanned: tTotals("totalPlanned"),
      totalRealised: tTotals("totalRealised"),
      totalOutstanding: tTotals("totalOutstanding"),
      averageProgress: tTotals("averageProgress"),
    },
    ring: {
      progress: tRing("progress"),
      budget: tRing("budget"),
    },
    labels: {
      client: tLabels("client"),
      noBudget: tLabels("noBudget"),
      planned: tLabels("planned"),
      realised: tLabels("realised"),
      outstanding: tLabels("outstanding"),
      utilisation: tLabels("utilisation"),
      milestones: tLabels("milestones"),
      over: tLabels("over"),
      onTrack: tLabels("onTrack"),
    },
  };

  if (snapshot.tiles.length === 0) {
    return (
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display">{labels.section.title}</CardTitle>
          <CardDescription>{labels.section.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid place-items-center rounded-xl border border-dashed border-border/70 px-6 py-14 text-center">
            <p className="text-sm font-medium">{labels.section.empty}</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {labels.section.emptyBody}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Rules §3 — hide monetary aggregates when the caller lacks the
  // `view_budget` capability. Active-project count and average
  // progress are non-monetary and always shown, so an Employee
  // still sees a meaningful portfolio header.
  const totalsItems: Array<{ key: string; label: string; value: string }> = [
    {
      key: "active",
      label: labels.totals.activeProjects,
      value: String(snapshot.activeProjectCount),
    },
  ];
  if (snapshot.showBudget) {
    totalsItems.push(
      {
        key: "planned",
        label: labels.totals.totalPlanned,
        value: formatIDR(snapshot.totalPlannedAll, { compact: true }),
      },
      {
        key: "realised",
        label: labels.totals.totalRealised,
        value: formatIDR(snapshot.totalRealizedAll, { compact: true }),
      },
      {
        key: "outstanding",
        label: labels.totals.totalOutstanding,
        value: formatIDR(snapshot.totalOutstandingAll, { compact: true }),
      },
    );
  }
  totalsItems.push({
    key: "progress",
    label: labels.totals.averageProgress,
    value: `${snapshot.averageProgressPct.toFixed(1)}%`,
  });

  return (
    <Card className="glass">
      <CardHeader className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="font-display">{labels.section.title}</CardTitle>
          <CardDescription>{labels.section.subtitle}</CardDescription>
        </div>
        <dl
          className={cn(
            "grid gap-x-6 gap-y-2 text-xs",
            snapshot.showBudget
              ? "grid-cols-2 sm:grid-cols-5"
              : "grid-cols-2 sm:grid-cols-2",
          )}
        >
          {totalsItems.map((item) => (
            <div key={item.key} className="min-w-0">
              <dt className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.label}
              </dt>
              <dd className="truncate font-display text-sm font-semibold">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.tiles.map((tile) => (
            <ProjectTile
              key={tile.projectId}
              tile={tile}
              labels={labels}
              showBudget={snapshot.showBudget}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectTile({
  tile,
  labels,
  showBudget,
}: {
  tile: PortfolioTile;
  labels: Labels;
  showBudget: boolean;
}) {
  const progress = Math.max(0, Math.min(100, tile.progressPct));
  const budgetPct = tile.budget.exists ? tile.budget.utilizationPct : 0;
  const overBudget = showBudget && tile.budget.exists && budgetPct > 100;

  const doneCount = tile.milestoneCounts.DONE;
  const inProgressCount = tile.milestoneCounts.IN_PROGRESS;
  const atRiskCount = tile.milestoneCounts.AT_RISK;
  const totalMilestones =
    doneCount +
    inProgressCount +
    atRiskCount +
    tile.milestoneCounts.PLANNED +
    tile.milestoneCounts.CANCELLED;

  // Aria label composes progress + budget when visible; drops the
  // budget half for capability-gated viewers so screen readers don't
  // announce a zero utilisation that isn't actually rendered.
  const ariaSummary = showBudget
    ? `${tile.name} — ${progress.toFixed(0)}% ${labels.ring.progress}, ${budgetPct.toFixed(0)}% ${labels.ring.budget}`
    : `${tile.name} — ${progress.toFixed(0)}% ${labels.ring.progress}`;

  return (
    <Link
      href={`/projects/${tile.projectId}`}
      className={cn(
        "group relative flex flex-col gap-4 rounded-xl border border-border/60 bg-card/40 p-4",
        "transition-all hover:border-primary/40 hover:bg-card/70 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
      aria-label={ariaSummary}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-meta truncate text-[10px] uppercase tracking-wider text-muted-foreground">
            {tile.code} · {tile.projectType.replace(/_/g, " ")}
          </p>
          <h3 className="mt-0.5 truncate font-display text-base font-semibold">
            {tile.name}
          </h3>
          {tile.clientName ? (
            <p className="truncate text-xs text-muted-foreground">
              {labels.labels.client}: {tile.clientName}
            </p>
          ) : null}
        </div>
        <ArrowUpRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </div>

      <div className="flex items-center gap-4">
        <HealthRing
          percent={progress}
          strokeColor={progressStrokeColor(progress)}
          topLabel={`${progress.toFixed(0)}%`}
          bottomLabel={labels.ring.progress}
        />
        {showBudget ? (
          <>
            <HealthRing
              percent={tile.budget.exists ? Math.min(100, budgetPct) : 0}
              strokeColor={
                tile.budget.exists
                  ? budgetStrokeColor(budgetPct)
                  : "var(--color-muted-foreground)"
              }
              topLabel={tile.budget.exists ? `${budgetPct.toFixed(0)}%` : "—"}
              bottomLabel={
                tile.budget.exists
                  ? labels.labels.utilisation
                  : labels.labels.noBudget
              }
              muted={!tile.budget.exists}
            />

            <div className="min-w-0 flex-1 space-y-1.5 text-xs">
              {tile.budget.exists ? (
                <>
                  <div className="flex justify-between gap-2 truncate">
                    <span className="text-muted-foreground">
                      {labels.labels.planned}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatIDR(tile.budget.planned, { compact: true })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 truncate">
                    <span className="text-muted-foreground">
                      {labels.labels.realised}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatIDR(tile.budget.realized, { compact: true })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 truncate">
                    <span className="text-muted-foreground">
                      {labels.labels.outstanding}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatIDR(tile.budget.outstanding, { compact: true })}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">{labels.labels.noBudget}</p>
              )}
            </div>
          </>
        ) : (
          // Non-budget viewer: fill the horizontal space with a
          // milestone-focused strip so the tile doesn't look
          // lopsided next to the single progress ring.
          <div className="min-w-0 flex-1 text-xs">
            {totalMilestones > 0 ? (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  {labels.labels.milestones}
                </p>
                <p className="font-medium">
                  <span className="font-semibold text-foreground">
                    {doneCount}
                  </span>
                  /{totalMilestones}
                  {inProgressCount > 0 ? (
                    <span className="ml-2 text-muted-foreground">
                      {inProgressCount} IP
                    </span>
                  ) : null}
                  {atRiskCount > 0 ? (
                    <span className="ml-2 text-destructive">
                      {atRiskCount} AR
                    </span>
                  ) : null}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">—</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {showBudget && overBudget ? (
          <Badge
            variant="outline"
            className="border-destructive/40 bg-destructive/10 text-destructive"
          >
            <AlertTriangle className="mr-1 size-3" />
            {labels.labels.over}
          </Badge>
        ) : showBudget && tile.budget.exists && budgetPct > 0 ? (
          <Badge
            variant="outline"
            className="border-success/40 bg-success/10 text-success"
          >
            <CheckCircle2 className="mr-1 size-3" />
            {labels.labels.onTrack}
          </Badge>
        ) : null}
        {showBudget && totalMilestones > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{doneCount}</span>/
            {totalMilestones} {labels.labels.milestones.toLowerCase()}
            {inProgressCount > 0 ? ` · ${inProgressCount} IP` : ""}
            {atRiskCount > 0 ? (
              <span className="ml-1 text-destructive">· {atRiskCount} AR</span>
            ) : null}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * Single ring — 26px radius, 6px stroke on a 64×64 viewbox. The center
 * shows the percentage; a small label sits below the ring.
 */
function HealthRing({
  percent,
  strokeColor,
  topLabel,
  bottomLabel,
  muted,
}: {
  percent: number;
  strokeColor: string;
  topLabel: string;
  bottomLabel: string;
  muted?: boolean;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <svg
          width="64"
          height="64"
          viewBox="0 0 64 64"
          aria-hidden="true"
          className={muted ? "opacity-60" : undefined}
        >
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.15"
            strokeWidth="6"
            className="text-muted-foreground"
          />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 32 32)"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-display text-xs font-semibold tabular-nums">
          {topLabel}
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {bottomLabel}
      </p>
    </div>
  );
}

function progressStrokeColor(pct: number): string {
  if (pct >= 80) return "var(--color-success, oklch(0.7 0.16 155))";
  if (pct >= 40) return "var(--color-warning, oklch(0.78 0.14 75))";
  return "var(--color-primary)";
}

function budgetStrokeColor(pct: number): string {
  if (pct > 100) return "var(--color-destructive, oklch(0.65 0.22 25))";
  if (pct >= 80) return "var(--color-warning, oklch(0.78 0.14 75))";
  return "var(--color-success, oklch(0.7 0.16 155))";
}
