import { z } from "zod";

/**
 * ControlDesk AI Insight payload schemas (rules §15).
 *
 * Every insight kind returns a structured JSON payload validated by Zod.
 * The payload is stored in `ai_insights.payload` (jsonb) and rendered by
 * the /insights dashboard.
 *
 * IMPORTANT: schemas are the source of truth. Update the DB migration + UI
 * if you extend them.
 */

// Shared envelope every insight surfaces.
const insightBase = z.object({
  headline: z
    .string()
    .trim()
    .min(4, "Headline must be substantive.")
    .max(160),
  summary: z.string().trim().min(10).max(1000),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  confidence: z.number().min(0).max(1),
});
export type InsightBase = z.infer<typeof insightBase>;

// ---------------------------------------------------------------------------
// 1. PREDICT_EXPENSE_IMPACT — Effect of pending expenses on gross margin.
// ---------------------------------------------------------------------------
export const predictExpenseImpactSchema = insightBase.extend({
  project_impacts: z
    .array(
      z.object({
        project_code: z.string(),
        current_margin_pct: z.number(),
        projected_margin_pct: z.number(),
        top_drivers: z.array(z.string()).min(1).max(5),
      }),
    )
    .min(0)
    .max(20),
  recommended_actions: z.array(z.string()).min(1).max(6),
});
export type PredictExpenseImpact = z.infer<typeof predictExpenseImpactSchema>;

// ---------------------------------------------------------------------------
// 2. ANALYZE_RESOURCE_UTILIZATION — PM + employee allocation health.
// ---------------------------------------------------------------------------
export const analyzeResourceUtilizationSchema = insightBase.extend({
  overallocated: z
    .array(
      z.object({
        employee_ref: z.string(), // redacted id_ref
        role: z.string(),
        total_allocation_pct: z.number(),
      }),
    )
    .max(50),
  underutilized: z
    .array(
      z.object({
        employee_ref: z.string(),
        role: z.string(),
        total_allocation_pct: z.number(),
      }),
    )
    .max(50),
  pm_load: z
    .array(
      z.object({
        pm_ref: z.string(),
        primary_projects: z.number().int().nonnegative(),
        co_projects: z.number().int().nonnegative(),
      }),
    )
    .max(20),
  recommended_actions: z.array(z.string()).min(1).max(6),
});
export type AnalyzeResourceUtilization = z.infer<
  typeof analyzeResourceUtilizationSchema
>;

// ---------------------------------------------------------------------------
// 3. ANALYZE_CLIENT_HEALTH — Health score per client.
// ---------------------------------------------------------------------------
export const analyzeClientHealthSchema = insightBase.extend({
  clients: z
    .array(
      z.object({
        client_name: z.string(),
        health_score: z.number().min(0).max(100),
        status: z.enum(["GREEN", "AMBER", "RED"]),
        signals: z.array(z.string()).min(1).max(6),
      }),
    )
    .min(0)
    .max(20),
  at_risk_revenue_bucket: z.enum([
    "<50jt",
    "50-250jt",
    "250jt-1M",
    "1-5M",
    ">5M",
  ]),
  recommended_actions: z.array(z.string()).min(1).max(6),
});
export type AnalyzeClientHealth = z.infer<typeof analyzeClientHealthSchema>;

// ---------------------------------------------------------------------------
// 4. ANALYZE_SLA_BREACH — 24-48h SLA breach risk forecast.
// ---------------------------------------------------------------------------
export const analyzeSlaBreachSchema = insightBase.extend({
  breach_forecasts: z
    .array(
      z.object({
        project_code: z.string(),
        breach_within_hours: z.number().min(0).max(72),
        breach_probability: z.number().min(0).max(1),
        contributing_factors: z.array(z.string()).min(1).max(6),
      }),
    )
    .max(20),
  penalty_exposure_bucket: z.enum([
    "<10jt",
    "10-50jt",
    "50-200jt",
    "200jt-1M",
    ">1M",
  ]),
  recommended_actions: z.array(z.string()).min(1).max(6),
});
export type AnalyzeSlaBreach = z.infer<typeof analyzeSlaBreachSchema>;

// ---------------------------------------------------------------------------
// Discriminated union — used by callers & storage layer.
// ---------------------------------------------------------------------------
export const AI_INSIGHT_KINDS = [
  "PREDICT_EXPENSE_IMPACT",
  "ANALYZE_RESOURCE_UTILIZATION",
  "ANALYZE_CLIENT_HEALTH",
  "ANALYZE_SLA_BREACH",
] as const;
export type AiInsightKindLiteral = (typeof AI_INSIGHT_KINDS)[number];

export const insightKindSchema = z.enum(AI_INSIGHT_KINDS);

export function schemaForKind(kind: AiInsightKindLiteral) {
  switch (kind) {
    case "PREDICT_EXPENSE_IMPACT":
      return predictExpenseImpactSchema;
    case "ANALYZE_RESOURCE_UTILIZATION":
      return analyzeResourceUtilizationSchema;
    case "ANALYZE_CLIENT_HEALTH":
      return analyzeClientHealthSchema;
    case "ANALYZE_SLA_BREACH":
      return analyzeSlaBreachSchema;
  }
}
