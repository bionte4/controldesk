import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopbar } from "@/components/shell/app-topbar";
import type { NotificationItem } from "@/components/shell/notifications-bell";
import type { InsightPreview } from "@/components/shell/ai-insights-badge";
import {
  CommandPalette,
  type KnowledgePaletteEntry,
} from "@/components/shell/command-palette";
import { IdleTimeoutProvider } from "@/components/shell/idle-timeout-provider";
import { PageTransition } from "@/components/shell/page-transition";
import { TrialBanner } from "@/components/shell/trial-banner";
import {
  resolveIdleTimeoutMinutes,
  resolveIdleWarningMinutes,
} from "@/lib/security/idle-timeout";
import { isLocale } from "@/lib/i18n/config";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { CAPABILITY_IDS } from "@/lib/rbac/capabilities";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import { loadTenantSearchIndex } from "@/lib/data/knowledge-articles";
import { createClient } from "@/lib/supabase/server";
import { HELP_MANIFEST } from "@/lib/help/articles";
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
  // Resolve the tenant-aware capability set ONCE at the layout root.
  // Every page under `(app)/*` re-reads the same in-memory cache
  // (React.cache) so this is effectively free after the first hit;
  // page guards share the exact same view.
  //
  // For the client-side sidebar we can't pass the full `CapabilitySet`
  // (its methods are functions, non-serialisable across the RSC ↔
  // Client boundary). Instead we compute a plain `string[]` of the
  // capability IDs this caller currently has, and let the sidebar
  // filter against that. Same source of truth, serialisation-safe.
  const capabilities = await resolveCapabilitiesFor();
  const allowedCapabilities = CAPABILITY_IDS.filter((id) =>
    capabilities.can(id),
  );
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

  // Slug allowlist for the global Ask AI drawer's citation rewrite.
  // The manifest is a compile-time const, so this array is free —
  // no file I/O, no DB roundtrip. `HELP_MANIFEST` is the single
  // source of truth for valid `/help/{slug}` targets.
  const helpArticleSlugs = HELP_MANIFEST.map((entry) => entry.slug);

  // Fase 2b: feed the Cmd+K palette with recent tenant KB articles
  // so power users can jump to internal SOPs without leaving the
  // keyboard. Capped at 20 to keep the palette payload lean — a
  // fuzzy match against titles + summaries is enough for the common
  // "which SOP was that?" flow; deep search remains on `/help`.
  const tenantSearchIndex = await loadTenantSearchIndex();
  const knowledgePaletteEntries: KnowledgePaletteEntry[] = tenantSearchIndex
    .slice(0, 20)
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      summary: row.summary,
    }));

  return (
    <IdleTimeoutProvider
      variant="app"
      timeoutMinutes={resolveIdleTimeoutMinutes()}
      warningMinutes={resolveIdleWarningMinutes()}
    >
      <SidebarProvider defaultOpen={defaultOpen}>
        <CommandPalette knowledgeArticles={knowledgePaletteEntries}>
          <AppSidebar
            role={employee.role}
            allowedCapabilities={allowedCapabilities}
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
              helpArticleSlugs={helpArticleSlugs}
            />
            <TrialBanner tenantId={employee.tenant_id} />
            <main className="flex-1 flex flex-col p-6 md:p-8">
              <PageTransition>{children}</PageTransition>
            </main>
          </SidebarInset>
        </CommandPalette>
      </SidebarProvider>
    </IdleTimeoutProvider>
  );
}
