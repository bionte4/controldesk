"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";
import { commit, reserve } from "@/lib/ai/cost-cap";
import { AI_INSIGHT_KINDS, runInsight } from "@/lib/ai/generators";
import { schemaForKind, type AiInsightKindLiteral } from "@/lib/ai/schemas";
import { resolveAiCapContext } from "@/lib/integrations/ai";
import { runAllInsightsSchema, runInsightSchema } from "@/lib/validation/insights";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  type Locale,
} from "@/lib/i18n/config";
import type {
  AiInsightKind,
  AiInsightSeverity,
  Json,
} from "@/types/database";

const ESTIMATED_OUTPUT_TOKENS = 800;

/**
 * Resolve the caller's UI locale from the `NEXT_LOCALE` cookie so the AI
 * emits every text field in the same language as the surrounding page
 * (rules §18 — locale hygiene, plus better UX for Indonesian operators).
 */
async function resolveInsightLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const stored = cookieStore.get(LOCALE_COOKIE)?.value;
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

async function generateAndStore(kind: AiInsightKindLiteral) {
  const actor = await requireCurrentEmployee();
  const locale = await resolveInsightLocale();

  // Per-tenant daily cap override + on-prem bypass flag. Loaded once
  // here so back-to-back runs of all four insight kinds don't repeat
  // the AI config lookup. `bypass=true` when the tenant's provider is
  // `OPENAI_COMPATIBLE` (Ollama / LM Studio / vLLM) — those requests
  // cost $0 so we skip both the reserve() check AND the commit() side
  // effects on the Redis counter (see cost-cap.ts).
  const { cap: tenantCap, bypass } = await resolveAiCapContext(
    actor.tenant_id,
  );

  const reservation = await reserve({
    tenantId: actor.tenant_id,
    estimatedOutputTokens: ESTIMATED_OUTPUT_TOKENS,
    cap: tenantCap ?? undefined,
    bypass,
  });
  if (!reservation.ok) {
    throw new Error(
      `Daily AI token cap reached — retry tomorrow. (${reservation.used}/${reservation.cap})`,
    );
  }

  const outcome = await runInsight(kind, actor, locale);

  await commit({
    tenantId: actor.tenant_id,
    delta: outcome.run.tokens_output - ESTIMATED_OUTPUT_TOKENS,
    bypass,
  });

  // Validate the payload against the kind's schema before persisting.
  const schema = schemaForKind(kind);
  const parsed = schema.safeParse(outcome.run.payload);
  if (!parsed.success) {
    log.warn("ai_insight_payload_invalid", {
      tenant_id: actor.tenant_id,
      kind,
      issues: parsed.error.issues.slice(0, 5),
    });
    throw new Error("Generated insight failed schema validation.");
  }

  const supabase = createServiceRoleClient();
  const { data: inserted, error } = await supabase
    .from("ai_insights")
    .insert({
      tenant_id: actor.tenant_id,
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
    })
    .select("id")
    .single();
  if (error || !inserted) {
    throw new Error(error?.message ?? "Failed to persist insight.");
  }

  return {
    inserted_id: inserted.id,
    kind,
    severity: parsed.data.severity,
    headline: parsed.data.headline,
    tokens_output: outcome.run.tokens_output,
    latency_ms: outcome.run.latency_ms,
    model_id: outcome.run.model_id,
  };
}

// ---------------------------------------------------------------------------
// runInsightAction — run one insight kind on demand.
// ---------------------------------------------------------------------------
export const runInsightAction = withSecureAction({
  schema: runInsightSchema,
  resource: "ai_insight",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "ai_insights",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input) => {
    const result = await generateAndStore(input.kind);
    revalidatePath("/insights");
    return {
      result,
      auditResourceId: result.inserted_id,
      auditNewValues: {
        kind: result.kind,
        severity: result.severity,
        model_id: result.model_id,
        tokens_output: result.tokens_output,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// runAllInsightsAction — run all four kinds sequentially (rate-friendly).
// ---------------------------------------------------------------------------
export const runAllInsightsAction = withSecureAction({
  schema: runAllInsightsSchema,
  resource: "ai_insight",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "ai_insights",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async () => {
    const results: Array<{
      kind: AiInsightKindLiteral;
      inserted_id: string;
      severity: string;
      headline: string;
    }> = [];
    const errors: Array<{ kind: AiInsightKindLiteral; reason: string }> = [];
    for (const kind of AI_INSIGHT_KINDS) {
      try {
        const r = await generateAndStore(kind);
        results.push(r);
      } catch (err) {
        errors.push({
          kind,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    revalidatePath("/insights");
    return {
      result: { ok_count: results.length, errors },
      auditNewValues: { ok_count: results.length, error_count: errors.length },
    };
  },
});
