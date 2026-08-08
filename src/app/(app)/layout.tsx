import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopbar } from "@/components/shell/app-topbar";
import type { NotificationItem } from "@/components/shell/notifications-bell";
import type { InsightPreview } from "@/components/shell/ai-insights-badge";
import { CommandPalette } from "@/components/shell/command-palette";
import { PageTransition } from "@/components/shell/page-transition";
import { isLocale } from "@/lib/i18n/config";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  AiInsightKind,
  AiInsightSeverity,
  NotificationKind,
} from "@/types/database";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";

const AI_INSIGHT_ROLES: readonly AnyDbEmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "LEAD_FINANCE",
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await requireCurrentEmployee();

  const supabase = await createClient();
  const canReadAiInsights = AI_INSIGHT_ROLES.includes(employee.role);
  const [{ data: tenant }, { data: notifications }, { data: aiInsightsRaw }] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("name, slug")
        .eq("id", employee.tenant_id)
        .single(),
      supabase
        .from("notifications")
        .select("id, kind, title, body, action_url, read_at, created_at")
        .eq("user_id", employee.user_id)
        .order("created_at", { ascending: false })
        .limit(20),
      canReadAiInsights
        ? supabase
            .from("ai_insights")
            .select("id, kind, severity, headline, created_at")
            .eq("tenant_id", employee.tenant_id)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] as InsightPreview[] }),
    ]);

  const notificationItems: NotificationItem[] = (notifications ?? []).map(
    (n) => ({
      id: n.id,
      kind: n.kind as NotificationKind,
      title: n.title,
      body: n.body,
      action_url: n.action_url,
      read_at: n.read_at,
      created_at: n.created_at,
    }),
  );

  const aiInsightItems: InsightPreview[] = (aiInsightsRaw ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as AiInsightKind,
    severity: r.severity as AiInsightSeverity,
    headline: r.headline,
    created_at: r.created_at,
  }));

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : "id";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <CommandPalette>
        <AppSidebar
          role={employee.role}
          tenantName={tenant?.name ?? "ControlDesk"}
          tenantSlug={employee.tenant_slug}
        />
        <SidebarInset className="min-h-svh flex flex-col">
          <AppTopbar
            fullName={employee.full_name}
            email={employee.email}
            role={employee.role}
            tenantSlug={employee.tenant_slug}
            userId={employee.user_id}
            tenantId={employee.tenant_id}
            notifications={notificationItems}
            aiInsights={aiInsightItems}
            locale={locale}
          />
          <main className="flex-1 flex flex-col p-6 md:p-8">
            <PageTransition>{children}</PageTransition>
          </main>
        </SidebarInset>
      </CommandPalette>
    </SidebarProvider>
  );
}
