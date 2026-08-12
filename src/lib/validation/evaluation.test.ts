import { describe, expect, it } from "vitest";

import {
  canonicalRecommendation,
  createEvaluationTemplateSchema,
  decideEvaluationByOmSchema,
  deriveExtensionMonths,
  reviewEvaluationByPmSchema,
  startEvaluationSchema,
  submitEvaluationBySpvSchema,
  updateEvaluationMetaSchema,
  upsertEvaluationAnswerSchema,
} from "./evaluation";

const uuid = "00000000-0000-4000-8000-000000000001";

describe("createEvaluationTemplateSchema", () => {
  it("requires at least one item", () => {
    const res = createEvaluationTemplateSchema.safeParse({
      name: "Template A",
      items: [],
    });
    expect(res.success).toBe(false);
  });

  it("accepts a template with a single item", () => {
    const res = createEvaluationTemplateSchema.safeParse({
      name: "Template A",
      items: [
        {
          seq: 1,
          name: "Quality of work",
          weight_pct: 100,
          question_type: "SCORE_1_5",
          is_required: true,
        },
      ],
    });
    expect(res.success).toBe(true);
  });

  it("rejects weight outside 0-100", () => {
    const res = createEvaluationTemplateSchema.safeParse({
      name: "T",
      items: [
        {
          seq: 1,
          name: "X",
          weight_pct: 150,
          question_type: "SCORE_1_5",
          is_required: true,
        },
      ],
    });
    expect(res.success).toBe(false);
  });
});

describe("upsertEvaluationAnswerSchema", () => {
  it("accepts a numeric score", () => {
    const res = upsertEvaluationAnswerSchema.safeParse({
      evaluation_id: uuid,
      item_id: uuid,
      numeric_score: 4,
    });
    expect(res.success).toBe(true);
  });

  it("rejects a score outside 1-5", () => {
    const res = upsertEvaluationAnswerSchema.safeParse({
      evaluation_id: uuid,
      item_id: uuid,
      numeric_score: 6,
    });
    expect(res.success).toBe(false);
  });
});

describe("submitEvaluationBySpvSchema", () => {
  it("requires a recommendation", () => {
    const res = submitEvaluationBySpvSchema.safeParse({ id: uuid });
    expect(res.success).toBe(false);
  });

  it("requires an end date when EXTEND is picked", () => {
    // Migration 0065-manual: SPV enters the new contract end date
    // by hand so Finance / HR receives the exact target date without
    // fixed duration presets.
    const res = submitEvaluationBySpvSchema.safeParse({
      id: uuid,
      spv_recommendation: "EXTEND",
    });
    expect(res.success).toBe(false);
  });

  it("accepts EXTEND with a valid end date", () => {
    const res = submitEvaluationBySpvSchema.safeParse({
      id: uuid,
      spv_recommendation: "EXTEND",
      contract_extension_end_date: "2026-04-30",
    });
    expect(res.success).toBe(true);
  });

  it("rejects a malformed extension end date", () => {
    const res = submitEvaluationBySpvSchema.safeParse({
      id: uuid,
      spv_recommendation: "EXTEND",
      contract_extension_end_date: "April 30 2026",
    });
    expect(res.success).toBe(false);
  });

  it("accepts NOT_EXTEND without an end date", () => {
    const res = submitEvaluationBySpvSchema.safeParse({
      id: uuid,
      spv_recommendation: "NOT_EXTEND",
    });
    expect(res.success).toBe(true);
  });

  it("rejects NOT_EXTEND when end date is set (mutually exclusive)", () => {
    const res = submitEvaluationBySpvSchema.safeParse({
      id: uuid,
      spv_recommendation: "NOT_EXTEND",
      contract_extension_end_date: "2026-04-30",
    });
    expect(res.success).toBe(false);
  });
});

describe("deriveExtensionMonths", () => {
  // Display helper only — server relies on it for the `+N bln`
  // summary shown on the detail page. Rounding is calendar-aware:
  // any spillover day bumps the count up so 30 days shows as "+1 bln".
  it("returns null for missing inputs", () => {
    expect(deriveExtensionMonths(null, "2026-04-30")).toBeNull();
    expect(deriveExtensionMonths("2026-01-31", null)).toBeNull();
  });
  it("returns null when the new date is not after the old date", () => {
    expect(deriveExtensionMonths("2026-04-30", "2026-04-30")).toBeNull();
    expect(deriveExtensionMonths("2026-04-30", "2026-04-01")).toBeNull();
  });
  it("computes clean month deltas", () => {
    expect(deriveExtensionMonths("2026-01-31", "2026-04-30")).toBe(3);
    expect(deriveExtensionMonths("2026-01-31", "2027-01-31")).toBe(12);
  });
  it("rounds partial months up", () => {
    // Jan 31 → Feb 15 = ~half a month → shown as 1
    expect(deriveExtensionMonths("2026-01-31", "2026-02-15")).toBe(1);
  });
});

describe("reviewEvaluationByPmSchema", () => {
  it("requires coaching notes when returning", () => {
    const res = reviewEvaluationByPmSchema.safeParse({
      id: uuid,
      decision: "RETURN",
    });
    expect(res.success).toBe(false);
  });

  it("allows approve without notes", () => {
    const res = reviewEvaluationByPmSchema.safeParse({
      id: uuid,
      decision: "APPROVE",
    });
    expect(res.success).toBe(true);
  });
});

describe("decideEvaluationByOmSchema", () => {
  it("requires notes when rejecting", () => {
    const res = decideEvaluationByOmSchema.safeParse({
      id: uuid,
      decision: "REJECT",
    });
    expect(res.success).toBe(false);
  });

  it("accepts approve without notes", () => {
    const res = decideEvaluationByOmSchema.safeParse({
      id: uuid,
      decision: "APPROVE",
    });
    expect(res.success).toBe(true);
  });
});

describe("startEvaluationSchema — PKWT period", () => {
  it("accepts start without end", () => {
    const res = startEvaluationSchema.safeParse({
      employee_id: uuid,
      template_id: uuid,
      period_start_date: "2025-08-01",
    });
    expect(res.success).toBe(true);
  });

  it("rejects when end precedes start", () => {
    const res = startEvaluationSchema.safeParse({
      employee_id: uuid,
      template_id: uuid,
      period_start_date: "2025-08-01",
      period_end_date: "2025-07-01",
    });
    expect(res.success).toBe(false);
  });

  it("rejects malformed date", () => {
    const res = startEvaluationSchema.safeParse({
      employee_id: uuid,
      template_id: uuid,
      period_start_date: "August 1 2025",
    });
    expect(res.success).toBe(false);
  });
});

describe("canonicalRecommendation", () => {
  // Migration 0065 collapsed the display set to 2 options: any
  // extension flavor now maps to `EXTEND`, terminations stay
  // `NOT_EXTEND`. Legacy rows written before 0065 (EXTEND_PERMANENT,
  // EXTEND_PKWT_3M, EXTEND_WITH_COACHING) round-trip through `EXTEND`.
  it("collapses every extension variant to EXTEND", () => {
    expect(canonicalRecommendation("EXTEND")).toBe("EXTEND");
    expect(canonicalRecommendation("EXTEND_PERMANENT")).toBe("EXTEND");
    expect(canonicalRecommendation("EXTEND_PKWT_3M")).toBe("EXTEND");
    expect(canonicalRecommendation("EXTEND_WITH_COACHING")).toBe("EXTEND");
  });
  it("keeps NOT_EXTEND stable", () => {
    expect(canonicalRecommendation("NOT_EXTEND")).toBe("NOT_EXTEND");
  });
});

describe("updateEvaluationMetaSchema", () => {
  it("accepts partial patch (strengths only)", () => {
    const res = updateEvaluationMetaSchema.safeParse({
      id: uuid,
      strengths: "Ownership tinggi, komunikasi bagus.",
    });
    expect(res.success).toBe(true);
  });

  it("accepts is_final_period flag", () => {
    const res = updateEvaluationMetaSchema.safeParse({
      id: uuid,
      is_final_period: true,
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.is_final_period).toBe(true);
  });

  it("normalizes empty strings to null", () => {
    const res = updateEvaluationMetaSchema.safeParse({
      id: uuid,
      strengths: "",
      dev_areas: "   ",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.strengths).toBeNull();
      expect(res.data.dev_areas).toBeNull();
    }
  });

  it("rejects goal_achievement_pct out of range", () => {
    const res = updateEvaluationMetaSchema.safeParse({
      id: uuid,
      goal_achievement_pct: 101,
    });
    expect(res.success).toBe(false);
  });

  it("rejects when period_end precedes period_start", () => {
    const res = updateEvaluationMetaSchema.safeParse({
      id: uuid,
      period_start_date: "2025-08-01",
      period_end_date: "2025-06-01",
    });
    expect(res.success).toBe(false);
  });
});
