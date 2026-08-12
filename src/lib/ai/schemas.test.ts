import { describe, expect, it } from "vitest";

import {
  AI_INSIGHT_KINDS,
  analyzeClientHealthSchema,
  analyzeResourceUtilizationSchema,
  analyzeSlaBreachSchema,
  predictExpenseImpactSchema,
  schemaForKind,
} from "./schemas";

describe("AI insight schemas — happy path", () => {
  it("accepts a full expense-impact payload", () => {
    const parsed = predictExpenseImpactSchema.safeParse({
      headline: "Projected margin dip on NUSA-CS",
      summary:
        "Pending expenses will push margin from 32% to 24% within 30 days.",
      severity: "WARNING",
      confidence: 0.7,
      project_impacts: [
        {
          project_code: "NUSA-CS",
          current_margin_pct: 32,
          projected_margin_pct: 24,
          top_drivers: ["Overtime spike", "Direct labour"],
        },
      ],
      recommended_actions: ["Reforecast", "Escalate to OM"],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a full resource-utilisation payload", () => {
    const parsed = analyzeResourceUtilizationSchema.safeParse({
      headline: "3 employees over-utilised.",
      summary: "Redistribute allocations before the next roster cycle.",
      severity: "WARNING",
      confidence: 0.8,
      overallocated: [
        { employee_ref: "aaaaaaaa", role: "SUPERVISOR", total_allocation_pct: 130 },
      ],
      underutilized: [],
      pm_load: [{ pm_ref: "bbbbbbbb", primary_projects: 4, co_projects: 1 }],
      recommended_actions: ["Rebalance allocations"],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a full client-health payload", () => {
    const parsed = analyzeClientHealthSchema.safeParse({
      headline: "One AMBER client identified.",
      summary: "PT Kirana Fintech needs a QBR within 2 weeks.",
      severity: "INFO",
      confidence: 0.6,
      clients: [
        {
          client_name: "PT Kirana Fintech",
          health_score: 62,
          status: "AMBER",
          signals: ["Late invoice", "One project ON_HOLD"],
        },
      ],
      at_risk_revenue_bucket: "50-250jt",
      recommended_actions: ["Schedule QBR"],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a full SLA-breach payload", () => {
    const parsed = analyzeSlaBreachSchema.safeParse({
      headline: "SLA breach within 12h on INDO-HELP",
      summary: "Weekend coverage gap detected.",
      severity: "CRITICAL",
      confidence: 0.9,
      breach_forecasts: [
        {
          project_code: "INDO-HELP",
          breach_within_hours: 12,
          breach_probability: 0.78,
          contributing_factors: ["Coverage gap", "Backlog growth"],
        },
      ],
      penalty_exposure_bucket: "200jt-1M",
      recommended_actions: ["Trigger surge shift"],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("AI insight schemas — validation errors", () => {
  it("rejects out-of-range health scores", () => {
    const parsed = analyzeClientHealthSchema.safeParse({
      headline: "Bad payload",
      summary: "Long enough summary here.",
      severity: "INFO",
      confidence: 0.5,
      clients: [
        {
          client_name: "X",
          health_score: 150,
          status: "GREEN",
          signals: ["only one signal"],
        },
      ],
      at_risk_revenue_bucket: "<50jt",
      recommended_actions: ["do stuff"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects blank headlines and summaries", () => {
    expect(
      predictExpenseImpactSchema.safeParse({
        headline: "  ",
        summary: "x".repeat(20),
        severity: "INFO",
        confidence: 0.5,
        project_impacts: [],
        recommended_actions: ["a"],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid severity", () => {
    expect(
      analyzeSlaBreachSchema.safeParse({
        headline: "x".repeat(10),
        summary: "y".repeat(20),
        severity: "NOPE",
        confidence: 0.5,
        breach_forecasts: [],
        penalty_exposure_bucket: "<10jt",
        recommended_actions: ["a"],
      }).success,
    ).toBe(false);
  });

  it("requires at least one recommended action", () => {
    expect(
      predictExpenseImpactSchema.safeParse({
        headline: "x".repeat(10),
        summary: "y".repeat(20),
        severity: "INFO",
        confidence: 0.5,
        project_impacts: [],
        recommended_actions: [],
      }).success,
    ).toBe(false);
  });
});

describe("schemaForKind dispatcher", () => {
  it("has an entry for every AI_INSIGHT_KIND", () => {
    for (const kind of AI_INSIGHT_KINDS) {
      const schema = schemaForKind(kind);
      expect(schema).toBeDefined();
    }
  });
});
