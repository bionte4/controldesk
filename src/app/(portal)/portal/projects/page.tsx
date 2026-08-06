import type { Metadata } from "next";
import Link from "next/link";
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
import { listPortalProjects } from "@/lib/portal/data";
import { requirePortalSession } from "@/lib/portal/session";
import type { Tables } from "@/types/database";

export const metadata: Metadata = { title: "Portal — Projects" };

type ProjectStatus = Tables<"projects">["status"];

const STATUS_TONE: Record<ProjectStatus, string> = {
  PLANNING: "border-white/10 bg-white/5 text-white/70",
  ACTIVE: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  ON_HOLD: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  COMPLETED: "border-indigo-400/30 bg-indigo-500/10 text-indigo-300",
  ARCHIVED: "border-white/10 bg-white/5 text-muted-foreground",
};

export default async function PortalProjectsListPage() {
  const session = await requirePortalSession();
  const [projects, t, tStatus] = await Promise.all([
    listPortalProjects(session),
    getTranslations("portal.projectList"),
    getTranslations("portal.projectStatus"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="label-meta">{t("kicker")}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {t("subtitle", { client: session.client.name })}
        </p>
      </header>

      {projects.length === 0 ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display">{t("empty")}</CardTitle>
            <CardDescription>{t("emptyBody")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="glass">
          <CardContent className="p-0">
            <ul className="divide-y divide-border/50">
              {projects.map((p) => {
                const pct = Math.max(
                  0,
                  Math.min(100, Number(p.progress ?? 0)),
                );
                return (
                  <li key={p.id}>
                    <Link
                      href={`/portal/projects/${p.id}`}
                      className="block px-6 py-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            <span className="text-muted-foreground text-xs mr-2 tabular-nums">
                              {p.code}
                            </span>
                            {p.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {p.start_date ?? "—"}
                            {" → "}
                            {p.end_date ?? "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge
                            variant="outline"
                            className={STATUS_TONE[p.status]}
                          >
                            {tStatus(p.status)}
                          </Badge>
                          <div className="w-40">
                            <Progress
                              value={pct}
                              aria-label={`${p.name} progress`}
                            />
                          </div>
                          <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                            {pct}%
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
