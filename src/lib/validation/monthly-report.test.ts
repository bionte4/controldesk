import { describe, expect, it } from "vitest";

import {
  createMonthlyReportSchema,
  decideMonthlyReportByPmSchema,
  generateBeritaAcaraSchema,
  periodMonthToDbDate,
  recordClientDecisionSchema,
  sendMonthlyReportToClientSchema,
  submitMonthlyReportSchema,
  upsertMonthlyReportSectionSchema,
} from "./monthly-report";

const UUID = "11111111-1111-4111-8111-000000000001";

describe("monthly-report schemas", () => {
  describe("createMonthlyReportSchema", () => {
    it("accepts YYYY-MM period", () => {
      const r = createMonthlyReportSchema.safeParse({
        project_id: UUID,
        period_month: "2026-07",
      });
      expect(r.success).toBe(true);
    });
    it("rejects invalid period format", () => {
      const r = createMonthlyReportSchema.safeParse({
        project_id: UUID,
        period_month: "2026/07",
      });
      expect(r.success).toBe(false);
    });
    it("rejects invalid month component", () => {
      const r = createMonthlyReportSchema.safeParse({
        project_id: UUID,
        period_month: "2026-13",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("upsertMonthlyReportSectionSchema", () => {
    it("accepts a valid section update", () => {
      const r = upsertMonthlyReportSectionSchema.safeParse({
        report_id: UUID,
        kind: "EXECUTIVE_SUMMARY",
        content: "All good.",
      });
      expect(r.success).toBe(true);
    });
    it("normalises empty content to undefined", () => {
      const r = upsertMonthlyReportSectionSchema.safeParse({
        report_id: UUID,
        kind: "BLOCKERS",
        content: "   ",
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.content).toBeUndefined();
    });
    it("rejects an unknown section kind", () => {
      const r = upsertMonthlyReportSectionSchema.safeParse({
        report_id: UUID,
        kind: "NEW_SECTION",
        content: "x",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("submitMonthlyReportSchema", () => {
    it("optional spv_notes", () => {
      const r = submitMonthlyReportSchema.safeParse({ id: UUID });
      expect(r.success).toBe(true);
    });
  });

  describe("decideMonthlyReportByPmSchema", () => {
    it("APPROVE without notes is allowed", () => {
      const r = decideMonthlyReportByPmSchema.safeParse({
        id: UUID,
        decision: "APPROVE",
      });
      expect(r.success).toBe(true);
    });
    it("RETURN requires notes", () => {
      const r = decideMonthlyReportByPmSchema.safeParse({
        id: UUID,
        decision: "RETURN",
      });
      expect(r.success).toBe(false);
    });
    it("REJECT requires notes", () => {
      const r = decideMonthlyReportByPmSchema.safeParse({
        id: UUID,
        decision: "REJECT",
      });
      expect(r.success).toBe(false);
    });
    it("RETURN with notes is accepted", () => {
      const r = decideMonthlyReportByPmSchema.safeParse({
        id: UUID,
        decision: "RETURN",
        pm_notes: "Please expand the milestone section.",
      });
      expect(r.success).toBe(true);
    });
  });

  describe("periodMonthToDbDate", () => {
    it("appends -01 to YYYY-MM", () => {
      expect(periodMonthToDbDate("2026-07")).toBe("2026-07-01");
    });
  });

  // ---- Slice B --------------------------------------------------

  describe("sendMonthlyReportToClientSchema", () => {
    it("id-only is allowed (dispatch without recorded email)", () => {
      const r = sendMonthlyReportToClientSchema.safeParse({ id: UUID });
      expect(r.success).toBe(true);
    });
    it("rejects an invalid email", () => {
      const r = sendMonthlyReportToClientSchema.safeParse({
        id: UUID,
        client_email: "not-an-email",
      });
      expect(r.success).toBe(false);
    });
    it("empty email normalises to undefined", () => {
      const r = sendMonthlyReportToClientSchema.safeParse({
        id: UUID,
        client_email: "",
      });
      // z.email refuses empty string, so empty means the caller should
      // omit the field. We accept undefined but not "".
      expect(r.success).toBe(false);
    });
  });

  describe("recordClientDecisionSchema", () => {
    it("APPROVE with just reviewer name is valid", () => {
      const r = recordClientDecisionSchema.safeParse({
        id: UUID,
        decision: "APPROVE",
        reviewer_name: "Ibu Sari",
      });
      expect(r.success).toBe(true);
    });
    it("REJECT without notes fails", () => {
      const r = recordClientDecisionSchema.safeParse({
        id: UUID,
        decision: "REJECT",
        reviewer_name: "Ibu Sari",
      });
      expect(r.success).toBe(false);
    });
    it("REJECT with notes is accepted", () => {
      const r = recordClientDecisionSchema.safeParse({
        id: UUID,
        decision: "REJECT",
        reviewer_name: "Ibu Sari",
        notes: "Section costs perlu breakdown per site.",
      });
      expect(r.success).toBe(true);
    });
    it("rejects an invalid decided_at format", () => {
      const r = recordClientDecisionSchema.safeParse({
        id: UUID,
        decision: "APPROVE",
        reviewer_name: "Sari",
        decided_at: "08-08-2026",
      });
      expect(r.success).toBe(false);
    });
    it("empty signature_path transforms to null", () => {
      const r = recordClientDecisionSchema.safeParse({
        id: UUID,
        decision: "APPROVE",
        reviewer_name: "Sari",
        signature_path: "",
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.signature_path).toBeNull();
    });
    it("reviewer_name is required (non-empty)", () => {
      const r = recordClientDecisionSchema.safeParse({
        id: UUID,
        decision: "APPROVE",
        reviewer_name: "",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("generateBeritaAcaraSchema", () => {
    it("id-only is valid — server fills period defaults", () => {
      const r = generateBeritaAcaraSchema.safeParse({ id: UUID });
      expect(r.success).toBe(true);
    });
    it("period_end before period_start fails", () => {
      const r = generateBeritaAcaraSchema.safeParse({
        id: UUID,
        period_start: "2026-08-31",
        period_end: "2026-08-01",
      });
      expect(r.success).toBe(false);
    });
    it("matching start / end is accepted (single-day BA)", () => {
      const r = generateBeritaAcaraSchema.safeParse({
        id: UUID,
        period_start: "2026-08-01",
        period_end: "2026-08-01",
      });
      expect(r.success).toBe(true);
    });
    it("normal ordered range is accepted", () => {
      const r = generateBeritaAcaraSchema.safeParse({
        id: UUID,
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        ba_notes: "Delivery Bank X wilayah Jakarta",
      });
      expect(r.success).toBe(true);
    });
    it("rejects malformed date", () => {
      const r = generateBeritaAcaraSchema.safeParse({
        id: UUID,
        period_start: "2026/08/01",
      });
      expect(r.success).toBe(false);
    });
  });
});
