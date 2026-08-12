import { getTranslations } from "next-intl/server";
import { AlertTriangle, Bug, Clock, Flag, Paperclip, Tag } from "lucide-react";

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
import { createClient } from "@/lib/supabase/server";
import type {
  ProjectIssueCategory,
  ProjectIssueSeverity,
  ProjectIssueStatus,
} from "@/types/database";

import { IssueRowActions } from "./issue-row-actions";
import {
  NewIssueSheet,
  type IssueAssigneeOption,
  type IssueMilestoneOption,
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

const CATEGORY_TONE: Record<ProjectIssueCategory, string> = {
  BUG: "bg-rose-500/10 text-rose-500 border-rose-500/25",
  FEATURE: "bg-chart-2/10 text-chart-2 border-chart-2/25",
  TASK: "bg-muted text-muted-foreground border-border",
  INCIDENT: "bg-orange-500/10 text-orange-500 border-orange-500/25",
  RISK: "bg-amber-500/10 text-amber-500 border-amber-500/25",
  IMPROVEMENT: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25",
  QUESTION: "bg-sky-500/10 text-sky-500 border-sky-500/25",
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

async function loadProjectMilestones(
  projectId: string,
): Promise<IssueMilestoneOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_milestones")
    .select("id, seq, name")
    .eq("project_id", projectId)
    .order("seq", { ascending: true });
  return (data ?? []).map((m) => ({
    id: m.id,
    label: `${String(m.seq).padStart(2, "0")} — ${m.name}`,
  }));
}

async function loadIssueAttachmentCounts(
  issueIds: string[],
): Promise<Record<string, number>> {
  if (issueIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("attachments")
    .select("resource_id")
    .eq("resource_type", "project_issue")
    .in("resource_id", issueIds);
  const tally: Record<string, number> = {};
  for (const row of data ?? []) {
    const key = row.resource_id as string;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

async function loadMilestoneLookup(
  projectId: string,
): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_milestones")
    .select("id, seq, name")
    .eq("project_id", projectId);
  const map: Record<string, string> = {};
  for (const m of data ?? []) {
    map[m.id as string] = `M${String(m.seq).padStart(2, "0")} · ${m.name}`;
  }
  return map;
}

export async function ProjectIssuesSection({
  projectId,
  projectLabel,
  employees,
  canAct,
  defaultSeverity,
}: {
  projectId: string;
  /**
   * Read-only label for the project, e.g. "PRJ-2026-0005 — RetailKu POS
   * Rollout". Displayed as the locked "Project" chip in the New Issue sheet
   * (matches the ORM-style mockup, rules §26).
   */
  projectLabel?: string;
  employees: IssueAssigneeOption[];
  canAct: boolean;
  /**
   * Inherited from `projects.priority` (rules §7). Feeds the default
   * severity value of the "New issue" sheet so a Critical project
   * triggers a 1h SLA on new issues.
   */
  defaultSeverity?: ProjectIssueSeverity;
}) {
  const [t, tStatus, tSev, tCat, tSla, issues, milestones, milestoneLookup] =
    await Promise.all([
      getTranslations("issues"),
      getTranslations("issues.status"),
      getTranslations("issues.severity"),
      getTranslations("issues.category"),
      getTranslations("issues.sla"),
      listIssuesByProject(projectId),
      loadProjectMilestones(projectId),
      loadMilestoneLookup(projectId),
    ]);
  const attachmentCounts = await loadIssueAttachmentCounts(
    issues.map((i) => i.id),
  );

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
          <NewIssueSheet
            projectId={projectId}
            projectLabel={projectLabel}
            employees={employees}
            milestones={milestones}
            defaultSeverity={defaultSeverity}
          />
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
                  <th className="px-4 py-3">{t("columns.category")}</th>
                  <th className="px-4 py-3">{t("columns.severity")}</th>
                  <th className="px-4 py-3">{t("columns.status")}</th>
                  <th className="px-4 py-3">{t("columns.sla")}</th>
                  <th className="px-4 py-3">{t("columns.assignee")}</th>
                  <th className="px-4 py-3">{t("columns.due")}</th>
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
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium">{issue.title}</p>
                      {issue.description ? (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {issue.description}
                        </p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {issue.milestone_id ? (
                          <Badge
                            variant="outline"
                            className="border-chart-2/25 bg-chart-2/10 text-chart-2 gap-1"
                          >
                            <Flag className="size-3" />
                            {milestoneLookup[issue.milestone_id] ??
                              t("milestoneMissing")}
                          </Badge>
                        ) : null}
                        {(issue.tags ?? []).slice(0, 3).map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="gap-1 border-border bg-muted/40 text-muted-foreground"
                          >
                            <Tag className="size-3" />
                            {tag}
                          </Badge>
                        ))}
                        {(issue.tags ?? []).length > 3 ? (
                          <span className="text-muted-foreground">
                            +{(issue.tags ?? []).length - 3}
                          </span>
                        ) : null}
                        {attachmentCounts[issue.id] ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-border bg-muted/40 text-muted-foreground"
                            aria-label={t("attachmentCountAria", {
                              count: attachmentCounts[issue.id],
                            })}
                          >
                            <Paperclip className="size-3" />
                            {attachmentCounts[issue.id]}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {issue.category ? (
                        <Badge
                          variant="outline"
                          className={CATEGORY_TONE[issue.category]}
                        >
                          {tCat(issue.category)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge
                        variant="outline"
                        className={SEVERITY_TONE[issue.severity]}
                      >
                        {tSev(issue.severity)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge
                        variant="outline"
                        className={STATUS_TONE[issue.status]}
                      >
                        {tStatus(issue.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <SlaBadge sla={issue.sla} tSla={tSla} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      {issue.assignee?.full_name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                      {issue.due_date
                        ? formatInTz(
                            new Date(issue.due_date).toISOString(),
                            "dd MMM yyyy",
                          )
                        : formatInTz(issue.created_at, "dd MMM yyyy")}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
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
