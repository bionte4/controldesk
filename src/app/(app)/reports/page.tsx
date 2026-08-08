import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import type { EmployeeRole } from "@/lib/rbac/roles";
import { reportsForRole } from "@/lib/reports/registry";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

/**
 * `/reports` — landing / index page. Mirrors the mockup: left column
 * lists every report the caller may run (icon + title + description +
 * quick CSV download link), right column shows a placeholder that
 * points the user at the report cards. Selecting a report navigates
 * to `/reports/<kind>` where filters + preview live.
 *
 * RBAC:
 *   - `requireCurrentEmployee` sends anonymous users to /login.
 *   - `reportsForRole()` filters cards by role; if the returned list
 *     is empty we redirect to /dashboard with a "forbidden" flag so
 *     the top-nav Reports link doesn't leave the user staring at an
 *     empty panel.
 */
export default async function ReportsIndexPage() {
  const employee = await requireCurrentEmployee();
  const dbRole = employee.role as EmployeeRole;
  const reports = reportsForRole(dbRole);
  if (reports.length === 0) {
    redirect("/dashboard?error=forbidden");
  }

  const [t, tList] = await Promise.all([
    getTranslations("reports"),
    getTranslations("reports.list"),
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
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {t("scopeLabel")}: {t(`scope.${scopeForRole(dbRole)}`)}
          </Badge>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
        {/* Left: choose a report */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("chooseTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {reports.map((r) => {
              const Icon = r.icon;
              return (
                <Link
                  key={r.kind}
                  href={`/reports/${r.kind}`}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border p-3 transition-colors",
                    "hover:border-primary/40 hover:bg-primary/5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  )}
                >
                  <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">
                        {/* Runtime-only dotted key — see comment in
                            [kind]/page.tsx for why the cast is safe. */}
                        {tList(r.titleKey as never)}
                      </span>
                      <Download className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {tList(r.descriptionKey as never)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        {/* Right: placeholder before user selects a report */}
        <Card className="glass min-h-[320px]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {t("placeholderTitle")}
            </CardTitle>
            <CardDescription>{t("placeholderSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t("placeholderBody")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Cheap heuristic for the scope badge — reflects what the caller will
 * *typically* see, not a hard guarantee (RLS is the source of truth).
 */
function scopeForRole(role: EmployeeRole): "org" | "portfolio" | "assigned" {
  if (
    role === "TENANT_ADMIN" ||
    role === "GENERAL_MANAGER" ||
    role === "LEAD_FINANCE" ||
    role === "HR_ADMIN"
  ) {
    return "org";
  }
  if (role === "HEAD_MANAGER" || role === "OPERATIONS_MANAGER") {
    return "portfolio";
  }
  return "assigned";
}
