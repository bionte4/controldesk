import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Briefcase, CheckCircle2, ListChecks } from "lucide-react";
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
  getPortalDashboardStats,
  listPortalProjects,
  type PortalProjectRow,
} from "@/lib/portal/data";
import { requirePortalSession } from "@/lib/portal/session";
import type { Tables } from "@/types/database";

export const metadata: Metadata = { title: "Portal" };

type ProjectStatus = Tables<"projects">["status"];

const STATUS_TONE: Record<ProjectStatus, string> = {
  PLANNING: "border-white/10 bg-white/5 text-white/70",
  ACTIVE: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  ON_HOLD: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  COMPLETED: "border-indigo-400/30 bg-indigo-500/10 text-indigo-300",
  ARCHIVED: "border-white/10 bg-white/5 text-muted-foreground",
};

export default async function PortalDashboardPage() {
  const session = await requirePortalSession();
  const [stats, projects, t, tStatus] = await Promise.all([
    getPortalDashboardStats(session),
    listPortalProjects(session),
    getTranslations("portal.dashboard"),
    getTranslations("portal.projectStatus"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="label-meta">{t("kicker")}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t("title", { client: session.client.name })}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {t("subtitle")}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <PortalKpi
          label={t("kpi.totalProjects")}
          value={String(stats.total_projects)}
          icon={<Briefcase className="size-5" aria-hidden="true" />}
        />
        <PortalKpi
          label={t("kpi.activeProjects")}
          value={String(stats.active_projects)}
          icon={<ListChecks className="size-5" aria-hidden="true" />}
        />
        <PortalKpi
          label={t("kpi.avgProgress")}
          value={`${stats.avg_progress_pct}%`}
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
        />
      </div>

      <Card className="glass">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="font-display">
                {t("projectsSection.title")}
              </CardTitle>
              <CardDescription>
                {t("projectsSection.subtitle")}
              </CardDescription>
            </div>
            <Link
              href="/portal/projects"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("projectsSection.viewAll")}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              {t("projectsSection.empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {projects.slice(0, 6).map((p) => (
                <PortalProjectListItem
                  key={p.id}
                  project={p}
                  statusLabel={tStatus(p.status)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PortalKpi({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="glass">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="label-meta text-muted-foreground">{label}</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums">
            {value}
          </p>
        </div>
        <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function PortalProjectListItem({
  project,
  statusLabel,
}: {
  project: PortalProjectRow;
  statusLabel: string;
}) {
  const progressPct = Math.max(0, Math.min(100, Number(project.progress ?? 0)));
  return (
    <li>
      <Link
        href={`/portal/projects/${project.id}`}
        className="block px-6 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium truncate">
              <span className="text-muted-foreground text-xs mr-2">
                {project.code}
              </span>
              {project.name}
            </p>
            {project.description ? (
              <p className="text-xs text-muted-foreground truncate max-w-2xl">
                {project.description}
              </p>
            ) : null}
          </div>
          <Badge variant="outline" className={STATUS_TONE[project.status]}>
            {statusLabel}
          </Badge>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Progress
            value={progressPct}
            className="max-w-md"
            aria-label={`${project.name} progress`}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {progressPct}%
          </span>
        </div>
      </Link>
    </li>
  );
}
