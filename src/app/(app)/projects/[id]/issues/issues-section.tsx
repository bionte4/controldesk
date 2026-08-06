import { getTranslations } from "next-intl/server";
import { AlertTriangle, Bug, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { listIssuesByProject, type IssueListItem } from "@/lib/issues/data";
import type {
  ProjectIssueSeverity,
  ProjectIssueStatus,
} from "@/types/database";

import { IssueRowActions } from "./issue-row-actions";
import {
  NewIssueSheet,
  type IssueAssigneeOption,
} from "./new-issue-sheet";

const SEVERITY_TONE: Record<ProjectIssueSeverity, string> = {
  CRITICAL: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  HIGH: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  MEDIUM: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  LOW: "bg-muted text-muted-foreground border-border",
};

const STATUS_TONE: Record<ProjectIssueStatus, string> = {
  OPEN: "bg-rose-500/10 text-rose-500 border-rose-500/30",
  IN_PROGRESS: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  RESOLVED: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  CLOSED: "bg-muted text-muted-foreground border-border",
  REOPENED: "bg-rose-500/15 text-rose-500 border-rose-500/30",
};

type SlaTranslator = (
  key: "breached" | "atRisk" | "onTrack",
  vars?: Record<string, string | number | Date>,
) => string;

/**
 * Render a compact SLA badge for an issue. `atRisk` and `breached` are
 * pre-computed by `issueSlaSnapshot()` so this component is pure.
 */
function SlaBadge({
  sla,
  tSla,
}: {
  sla: IssueListItem["sla"];
  tSla: SlaTranslator;
}) {
  if (sla.breached) {
    const hours = Math.abs(Math.floor(sla.remainingMinutes / 60));
    return (
      <Badge
        variant="outline"
        className="bg-rose-500/15 text-rose-500 border-rose-500/30"
      >
        <AlertTriangle className="size-3" /> {tSla("breached", { hours })}
      </Badge>
    );
  }
  if (sla.atRisk) {
    return (
      <Badge
        variant="outline"
        className="bg-amber-500/15 text-amber-500 border-amber-500/30"
      >
        <Clock className="size-3" />{" "}
        {tSla("atRisk", { minutes: sla.remainingMinutes })}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-muted text-muted-foreground border-border"
    >
      <Clock className="size-3" /> {tSla("onTrack")}
    </Badge>
  );
}

export async function ProjectIssuesSection({
  projectId,
  employees,
  canAct,
}: {
  projectId: string;
  employees: IssueAssigneeOption[];
  canAct: boolean;
}) {
  const [t, tStatus, tSev, tSla, issues] = await Promise.all([
    getTranslations("issues"),
    getTranslations("issues.status"),
    getTranslations("issues.severity"),
    getTranslations("issues.sla"),
    listIssuesByProject(projectId),
  ]);

  return (
    <Card className="glass" id="issues">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bug className="size-4" /> {t("title")}
          </CardTitle>
          <CardDescription>
            {t("subtitle", { count: issues.length })}
          </CardDescription>
        </div>
        {canAct ? (
          <NewIssueSheet projectId={projectId} employees={employees} />
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {issues.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              aria-label={t("tableAria")}
            >
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="px-4 py-3">{t("columns.title")}</th>
                  <th className="px-4 py-3">{t("columns.severity")}</th>
                  <th className="px-4 py-3">{t("columns.status")}</th>
                  <th className="px-4 py-3">{t("columns.sla")}</th>
                  <th className="px-4 py-3">{t("columns.assignee")}</th>
                  <th className="px-4 py-3">{t("columns.created")}</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr
                    key={issue.id}
                    id={`issue-${issue.id}`}
                    className="border-b border-border/40 last:border-none"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{issue.title}</p>
                      {issue.description ? (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {issue.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={SEVERITY_TONE[issue.severity]}
                      >
                        {tSev(issue.severity)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={STATUS_TONE[issue.status]}
                      >
                        {tStatus(issue.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <SlaBadge sla={issue.sla} tSla={tSla} />
                    </td>
                    <td className="px-4 py-3">
                      {issue.assignee?.full_name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatInTz(issue.created_at, "dd MMM yyyy, HH:mm")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <IssueRowActions
                        issueId={issue.id}
                        currentStatus={issue.status}
                        canAct={canAct}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
