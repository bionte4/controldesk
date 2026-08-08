import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BadgeDollarSign } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateOnly } from "@/lib/format/date";
import { toCanonicalRole } from "@/lib/rbac/roles";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { NewTemplateSheet } from "./new-template-sheet";
import { TemplateRowActions } from "./template-row-actions";

export const metadata: Metadata = { title: "Evaluation templates" };

/**
 * HR/Admin console for evaluation templates (rules §6, §12).
 *
 * Non-managers can read but not mutate — enforced by PDP + RLS. We
 * hide the "New template" affordance for those roles rather than
 * relying on server errors to teach the UI.
 */
export default async function EvaluationTemplatesPage() {
  const [employee, t, tCommon] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("performance"),
    getTranslations("common"),
  ]);
  const supabase = await createClient();

  // Group query — pull templates + items count + weight sum in one
  // trip. `evaluation_template_items(id, weight_pct)` returns a nested
  // array we aggregate client-side (row count small: 50 items max per
  // template).
  const { data: rows } = await supabase
    .from("evaluation_templates")
    .select(
      "id, name, description, is_active, created_at, updated_at, evaluation_template_items(id, weight_pct)",
    )
    .eq("tenant_id", employee.tenant_id)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });

  type Row = {
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    evaluation_template_items: Array<{ id: string; weight_pct: string }>;
  };
  const templates = (rows ?? []) as unknown as Row[];

  const canonical = toCanonicalRole(employee.role);
  const canManage =
    canonical === "ADMIN" ||
    canonical === "DIRECTOR" ||
    canonical === "OM" ||
    // HR_ADMIN maps to `ADMIN` in canonical? No — HR_ADMIN is its own
    // role in the legacy enum. Accept both by including the raw role
    // check to keep the surface open for HR staff.
    employee.role === "HR_ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/hr/performance" />}
        >
          <ArrowLeft className="size-4" />
          {t("form.returnToList")}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <BadgeDollarSign className="size-6" />
          </div>
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {t("templates.title")}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {t("templates.subtitle")}
            </p>
          </div>
        </div>
        {canManage ? <NewTemplateSheet /> : null}
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("templates.title")}</CardTitle>
          <CardDescription>{t("templates.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
              <p className="font-medium">{t("empty")}</p>
              <p>{t("emptyBody")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="py-2 pr-3">{t("templates.columns.name")}</th>
                    <th className="py-2 pr-3">
                      {t("templates.columns.items")}
                    </th>
                    <th className="py-2 pr-3">
                      {t("templates.columns.weight")}
                    </th>
                    <th className="py-2 pr-3">
                      {t("templates.columns.status")}
                    </th>
                    <th className="py-2 pr-3">
                      {t("templates.columns.updated")}
                    </th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {templates.map((tpl) => {
                    const items = tpl.evaluation_template_items ?? [];
                    const weightTotal = items.reduce(
                      (s, it) => s + Number(it.weight_pct),
                      0,
                    );
                    return (
                      <tr key={tpl.id} className="hover:bg-muted/30">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{tpl.name}</div>
                          {tpl.description ? (
                            <div className="text-xs text-muted-foreground line-clamp-1">
                              {tpl.description}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {items.length}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          <span
                            className={
                              weightTotal === 100
                                ? "text-emerald-500"
                                : weightTotal === 0
                                  ? "text-muted-foreground"
                                  : "text-amber-500"
                            }
                          >
                            {weightTotal.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant="outline"
                            className={
                              tpl.is_active
                                ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                                : "bg-muted text-muted-foreground border-border"
                            }
                          >
                            {tpl.is_active
                              ? tCommon("active")
                              : tCommon("inactive")}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {formatDateOnly(tpl.updated_at)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {canManage ? (
                            <TemplateRowActions
                              templateId={tpl.id}
                              isActive={tpl.is_active}
                            />
                          ) : null}
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
    </div>
  );
}
