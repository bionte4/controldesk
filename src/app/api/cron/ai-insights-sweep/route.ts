import { NextResponse } from "next/server";

import { AI_INSIGHT_KINDS, runInsight } from "@/lib/ai/generators";
import { commit, reserve } from "@/lib/ai/cost-cap";
import {
  loadTenantAiConfig,
  resolveAiCapContext,
} from "@/lib/integrations/ai";
import { schemaForKind, type AiInsightKindLiteral } from "@/lib/ai/schemas";
import type { CurrentEmployee } from "@/lib/auth/session";
import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type {
  AiInsightKind,
  AiInsightSeverity,
  Database,
  Json,
} from "@/types/database";

/**
 * AI Insights sweep cron (rules §15).
 *
 * `POST /api/cron/ai-insights-sweep`
 * `POST /api/cron/ai-insights-sweep?dry_run=true`
 * `POST /api/cron/ai-insights-sweep?tenant_slug=demo` (single-tenant sweep)
 *
 * Iterates every tenant with an active `tenant_ai_configs` row (or any
 * tenant when the env fallback is configured), and — for each of the four
 * insight kinds — regenerates the row only when the newest existing row
 * is older than the tenant's freshness window (per-tenant since migration
 * 0091 — `tenant_ai_configs.insight_freshness_min`, default 15 min). That
 * keeps the token spend bounded even at the tight 15-minute schedule.
 *
 * Multi-tenant safety: each per-tenant iteration synthesises a "system"
 * actor (see `resolveSystemActor` below) that carries only that tenant's
 * `tenant_id` and `tenant_slug`. Every generator query now includes an
 * explicit `.eq("tenant_id", …)` filter (see `src/lib/ai/generators.ts`),
 * so even with a service-role client the queries can't leak across
 * tenants.
 *
 * Wire-up (Vercel Cron / any scheduler):
 *   { "path": "/api/cron/ai-insights-sweep", "schedule": "STAR/15 * * * *" }
 * (Actual `*` instead of STAR — kept out of a raw JSON comment above.)
 *
 * Auth:
 *   - `Authorization: Bearer <CRON_SECRET>` (matches every other cron),
 *   - or `x-vercel-cron-signature: <CRON_SECRET>` (Vercel platform header).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A newly-produced insight is treated as "fresh" for a per-tenant window.
// Historically this was a hardcoded 15-minute constant; it moved to
// `tenant_ai_configs.insight_freshness_min` in migration 0091 so admins
// can tune the tradeoff between real-time data and token spend from
// Settings > Integrations > AI. `DEFAULT_FRESHNESS_WINDOW_MIN` remains
// the fallback for tenants without a config row (env-global provider).
const DEFAULT_FRESHNESS_WINDOW_MIN = 15;
const ESTIMATED_OUTPUT_TOKENS = 800;

type SweepPerTenant = {
  tenant_id: string;
  tenant_slug: string;
  /** Effective freshness window used for this tenant on this run. */
  freshness_window_min: number;
  generated: Array<{ kind: AiInsightKindLiteral; severity: string }>;
  skipped_fresh: AiInsightKindLiteral[];
  errors: Array<{ kind: AiInsightKindLiteral; reason: string }>;
};

async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  // In dev, unauthenticated invocations are allowed so `curl localhost:3000`
  // works from a terminal for smoke testing. Prod without CRON_SECRET is a
  // misconfiguration and we lock it down.
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const vercelHeader = request.headers.get("x-vercel-cron-signature");
  return !!vercelHeader && vercelHeader === secret;
}

async function loadEligibleTenants(
  supabase: ReturnType<typeof createServiceRoleClient>,
  onlySlug: string | null,
): Promise<Array<{ id: string; slug: string; name: string }>> {
  // Filter down to tenants the platform is actively servicing. `terminated`
  // tenants keep an audit-only row; we don't want the AI cron to keep
  // burning tokens on those.
  let q = supabase
    .from("tenants")
    .select("id, slug, name, status")
    .in("status", ["active", "suspended"])
    .order("slug", { ascending: true })
    .limit(500);
  if (onlySlug) q = q.eq("slug", onlySlug);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
}

/**
 * Synthesise a `CurrentEmployee`-shaped actor for the cron path. The
 * generator functions only touch `actor.tenant_id` (Supabase filter) and
 * `actor.tenant_slug` (prompt scope guard), so we don't need to hydrate a
 * real employee row for every tenant. Falling back to the first
 * `TENANT_ADMIN` on the tenant keeps the `requested_by` audit column
 * meaningful (points at a real accountable admin, not a synthetic uuid).
 */
async function resolveSystemActor(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tenant: { id: string; slug: string },
): Promise<CurrentEmployee | null> {
  const { data: admin } = await supabase
    .from("employees")
    .select("id, user_id, tenant_id, role, full_name, email")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .in("role", ["TENANT_ADMIN", "GENERAL_MANAGER"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!admin) return null;
  // The generator functions read a handful of fields off the actor. The
  // shape isn't fully populated — that's fine, the wider `Tables<"employees">`
  // properties are unused on the cron path.
  return {
    id: admin.id,
    user_id: admin.user_id ?? "",
    tenant_id: admin.tenant_id,
    role: admin.role,
    full_name: admin.full_name,
    email: admin.email,
    tenant_slug: tenant.slug,
    // Cast to placate the strict `CurrentEmployee` shape. Unused fields on
    // this path — the generators only touch what's spelled out above.
  } as unknown as CurrentEmployee;
}

async function latestInsightForKind(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  kind: AiInsightKindLiteral,
): Promise<{ created_at: string } | null> {
  const { data } = await supabase
    .from("ai_insights")
    .select("created_at")
    .eq("tenant_id", tenantId)
    .eq("kind", kind as AiInsightKind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

function isFresh(
  latest: { created_at: string } | null,
  now: Date,
  freshnessMin: number,
): boolean {
  if (!latest) return false;
  const ageMs = now.getTime() - new Date(latest.created_at).getTime();
  return ageMs < freshnessMin * 60_000;
}

async function sweepTenant(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tenant: { id: string; slug: string; name: string },
  now: Date,
  dryRun: boolean,
): Promise<SweepPerTenant> {
  // Resolve the tenant's per-tenant freshness window (migration 0091).
  // Rows created before that migration land at the DB default of 15; a
  // tenant with no `tenant_ai_configs` row at all falls back to the
  // module-level default so behaviour matches the pre-0091 code path.
  const aiCfg = await loadTenantAiConfig(tenant.id);
  const freshnessMin =
    aiCfg?.insightFreshnessMin ?? DEFAULT_FRESHNESS_WINDOW_MIN;

  const result: SweepPerTenant = {
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    freshness_window_min: freshnessMin,
    generated: [],
    skipped_fresh: [],
    errors: [],
  };

  const actor = await resolveSystemActor(supabase, tenant);
  if (!actor) {
    result.errors.push({
      kind: "PREDICT_EXPENSE_IMPACT",
      reason: "No active TENANT_ADMIN / GENERAL_MANAGER — skipping tenant.",
    });
    return result;
  }

  // Load cap + bypass flag once per tenant. `bypass=true` for on-prem
  // (OPENAI_COMPATIBLE) providers — see resolver.ts + cost-cap.ts for
  // the full rationale.
  const { cap, bypass } = await resolveAiCapContext(tenant.id);

  for (const kind of AI_INSIGHT_KINDS) {
    try {
      const latest = await latestInsightForKind(supabase, tenant.id, kind);
      if (isFresh(latest, now, freshnessMin)) {
        result.skipped_fresh.push(kind);
        continue;
      }

      if (dryRun) {
        result.generated.push({ kind, severity: "DRY_RUN" });
        continue;
      }

      const reservation = await reserve({
        tenantId: tenant.id,
        estimatedOutputTokens: ESTIMATED_OUTPUT_TOKENS,
        cap: cap ?? undefined,
        bypass,
      });
      if (!reservation.ok) {
        result.errors.push({
          kind,
          reason: `Daily AI token cap reached (${reservation.used}/${reservation.cap}).`,
        });
        // Once the cap is hit for one kind, subsequent kinds will also hit
        // it. Bail early to avoid spamming Redis.
        break;
      }

      // Locale defaults to Indonesian for the cron path — the UI covers
      // per-user locale on the manual "Run" button.
      const outcome = await runInsight(kind, actor, "id", supabase as unknown as Parameters<typeof runInsight>[3]);

      await commit({
        tenantId: tenant.id,
        delta: outcome.run.tokens_output - ESTIMATED_OUTPUT_TOKENS,
        bypass,
      });

      const schema = schemaForKind(kind);
      const parsed = schema.safeParse(outcome.run.payload);
      if (!parsed.success) {
        result.errors.push({
          kind,
          reason: `Generated insight failed schema validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        });
        continue;
      }

      const { error } = await supabase.from("ai_insights").insert({
        tenant_id: tenant.id,
        kind: kind as AiInsightKind,
        severity: parsed.data.severity as AiInsightSeverity,
        headline: parsed.data.headline,
        summary: parsed.data.summary,
        payload: parsed.data as unknown as Json,
        prompt_version: outcome.run.prompt_version,
        model_id: outcome.run.model_id,
        tokens_input: outcome.run.tokens_input,
        tokens_output: outcome.run.tokens_output,
        latency_ms: outcome.run.latency_ms,
        requested_by: actor.id,
      });
      if (error) throw new Error(error.message);

      result.generated.push({ kind, severity: parsed.data.severity });
    } catch (err) {
      result.errors.push({
        kind,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("ai-insights sweep: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const onlySlug = url.searchParams.get("tenant_slug");
  const startedAt = new Date();

  const supabase = createServiceRoleClient();

  // Log this as a real cron run so `/api/health/ready` and the daily digest
  // notice when the sweep goes red across multiple runs.
  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "ai_insights_sweep",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    const tenants = await loadEligibleTenants(supabase, onlySlug);
    const perTenant: SweepPerTenant[] = [];
    let generated = 0;
    let skipped = 0;
    let errors = 0;

    for (const t of tenants) {
      const r = await sweepTenant(supabase, t, startedAt, dryRun);
      perTenant.push(r);
      generated += r.generated.length;
      skipped += r.skipped_fresh.length;
      errors += r.errors.length;
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: errors > 0 && generated === 0 ? "FAILED" : "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: generated,
          details: {
            dry_run: dryRun,
            // Kept as `default_freshness_window_min` so ops dashboards can
            // still surface the module default while `per_tenant[i]
            // .freshness_window_min` shows the effective value each tenant
            // actually used (may differ post-migration 0091).
            default_freshness_window_min: DEFAULT_FRESHNESS_WINDOW_MIN,
            tenants_scanned: tenants.length,
            generated,
            skipped_fresh: skipped,
            errors,
            per_tenant: perTenant,
          } as unknown as Database["public"]["Tables"]["cron_run_log"]["Row"]["details"],
        })
        .eq("id", runId);
    }

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        default_freshness_window_min: DEFAULT_FRESHNESS_WINDOW_MIN,
        tenants_scanned: tenants.length,
        generated,
        skipped_fresh: skipped,
        errors,
        per_tenant: perTenant,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("ai-insights sweep failed", { error: errorMsg });
    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "FAILED",
          finished_at: new Date().toISOString(),
          error_message: errorMsg,
        })
        .eq("id", runId);
    }
    return NextResponse.json(
      { status: "failed", error: errorMsg },
      { status: 500 },
    );
  }
}
