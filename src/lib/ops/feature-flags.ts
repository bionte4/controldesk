/**
 * Feature flag registry + runtime helpers.
 *
 * Introduced by migration 0077 (tenant_feature_flags table). Feature
 * keys are canonical constants declared here — DB stores rows keyed
 * by these strings. Adding a new feature = add a `FEATURE_KEYS` entry
 * + wire a check in the code path that gates on it.
 *
 * Contract:
 *   • Missing row = feature is OFF (fail-closed).
 *   • Row with `enabled=false` = feature is OFF.
 *   • Row with `enabled=true` = feature is ON.
 *   • Platform admins manage rows via /super-admin/tenants/{id}.
 *   • Tenants can READ their own row (see rules §17.9 / migration 0077
 *     RLS policy) but CANNOT toggle.
 */

import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";

/**
 * All feature keys known to the app. Keeping the registry in code
 * means: (1) TypeScript autocompletes callsites, (2) the /super-admin
 * UI can render toggles for every registered feature without hitting
 * DB for the catalog.
 *
 * When adding a feature: append here, then wire `isFeatureEnabled(tenantId, "…")`
 * into the guarded code path. The `defaultEnabled` field is the
 * fallback used when no DB row exists (usually false; set true only
 * for features you want on-by-default for every tenant).
 */
export const FEATURE_REGISTRY = {
  wbs_gantt: {
    label: "WBS + Gantt Chart",
    description:
      "Hierarchical Work Breakdown Structure with Gantt visualization in project detail. Introduced with migration 0075.",
    defaultEnabled: true, // Shipped as a general availability feature
  },
  ai_insights: {
    label: "AI Insights",
    description:
      "Vercel AI SDK-powered structured insights (expense-impact, resource utilization, client health, SLA breach). Requires tenant_ai_configs row.",
    defaultEnabled: true,
  },
  google_calendar_sync: {
    label: "Google Calendar sync",
    description:
      "Push project milestones + events to a Google Calendar per tenant. Requires OAuth setup in Settings → Integrations.",
    defaultEnabled: false, // Off by default — needs manual OAuth
  },
  telegram_bot: {
    label: "Telegram bot notifications",
    description:
      "Bell notifications forwarded to a per-tenant Telegram bot. Requires Fonnte-like bot token in Settings.",
    defaultEnabled: false,
  },
  whatsapp_notifications: {
    label: "WhatsApp notifications",
    description:
      "Notifications forwarded via Fonnte / Twilio. Requires tenant_whatsapp_configs row.",
    defaultEnabled: false,
  },
  bulk_import: {
    label: "Bulk CSV import",
    description:
      "CSV import for clients/projects/employees. Powerful — audit trail records every imported row.",
    defaultEnabled: true,
  },
  advanced_reports: {
    label: "Advanced monthly reports",
    description:
      "PDF-exportable monthly reports with slice B (expense register, budget burn, utilization).",
    defaultEnabled: true,
  },
  ai_chatbot_tools: {
    label: "AI chatbot tool calling (Level 2)",
    description:
      "Enables `/help?tab=ask` to call read-only tools that surface the caller's own tenant data (pending approvals, timesheet, project status, budget remaining). Turning this OFF keeps the chatbot at Level 1 (docs-only RAG) — useful for tenants with heightened data-handling requirements. Level 3 inline copilot and Level 1 chatbot are unaffected.",
    defaultEnabled: true,
  },
} as const satisfies Record<
  string,
  { label: string; description: string; defaultEnabled: boolean }
>;

export type FeatureKey = keyof typeof FEATURE_REGISTRY;

export const FEATURE_KEYS = Object.keys(FEATURE_REGISTRY) as readonly FeatureKey[];

export function isKnownFeatureKey(key: string): key is FeatureKey {
  return key in FEATURE_REGISTRY;
}

export function defaultFor(key: FeatureKey): boolean {
  return FEATURE_REGISTRY[key].defaultEnabled;
}

/**
 * Resolve whether a given feature is enabled for a tenant. Cached
 * per-request (React `cache()`) so multiple gates in the same RSC
 * tree only hit the DB once per (tenant, feature) pair.
 *
 * Fail-open behaviour: if the DB query itself errors (network, RLS
 * misconfig), we log and fall back to `defaultEnabled`. This is a
 * conscious tradeoff — the alternative (hard-fail the render) would
 * take down the whole app for a config-plane hiccup. If a feature is
 * security-sensitive, add an explicit second gate at the mutation
 * layer instead of relying on the flag alone.
 */
export const isFeatureEnabled = cache(
  async (tenantId: string, key: FeatureKey): Promise<boolean> => {
    if (!tenantId) return defaultFor(key);
    try {
      const supabase = await createClient();
      // Commercial entitlement and operational feature flag are independent:
      // the customer must be entitled AND the rollout flag must allow it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entitlementResult = await (supabase as any).rpc(
        "resolve_tenant_entitlement",
        { p_tenant: tenantId, p_capability: key },
      );
      if (!entitlementResult.error) {
        const entitlement = Array.isArray(entitlementResult.data)
          ? entitlementResult.data[0]
          : entitlementResult.data;
        if (!entitlement?.enabled) return false;
      } else {
        // Migration-forward compatibility: deployments rolling app before DB
        // keep prior flag behaviour instead of taking down tenant navigation.
        log.warn("isFeatureEnabled: entitlement lookup unavailable", {
          tenant_id: tenantId,
          feature_key: key,
          error: entitlementResult.error.message,
        });
      }
      const { data, error } = await supabase
        .from("tenant_feature_flags")
        .select("enabled")
        .eq("tenant_id", tenantId)
        .eq("feature_key", key)
        .maybeSingle();
      if (error) {
        log.warn("isFeatureEnabled: db error, using default", {
          tenant_id: tenantId,
          feature_key: key,
          error: error.message,
        });
        return defaultFor(key);
      }
      if (data === null) {
        // No row → default. Deliberately don't log at info level to
        // avoid flooding — this is the common case for tenants that
        // never toggled the flag.
        return defaultFor(key);
      }
      return data.enabled;
    } catch (err) {
      log.warn("isFeatureEnabled: unexpected error, using default", {
        tenant_id: tenantId,
        feature_key: key,
        error: err instanceof Error ? err.message : String(err),
      });
      return defaultFor(key);
    }
  },
);
