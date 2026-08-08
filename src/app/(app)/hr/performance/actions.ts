"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { translatorFor } from "@/lib/notifications/localize";
import {
  createEvaluationTemplateSchema,
  decideEvaluationByOmSchema,
  deriveExtensionMonths,
  reviewEvaluationByPmSchema,
  startEvaluationSchema,
  submitEvaluationBySpvSchema,
  toggleEvaluationTemplateActiveSchema,
  updateEvaluationMetaSchema,
  updateEvaluationTemplateSchema,
  upsertEvaluationAnswerSchema,
  type EvaluationStatus,
} from "@/lib/validation/evaluation";
import { computeUpkAmount } from "@/lib/validation/upk";

/**
 * Performance evaluation actions (rules §6, §12). Workflow:
 *   SPV drafts → SUBMITTED_BY_SPV → PM reviews (APPROVE / RETURN)
 *   → REVIEWED_BY_PM → OM decides (APPROVE / REJECT)
 *   → APPROVED_BY_OM + FINALIZED  (spawns UPK stub if NOT_EXTEND)
 *   → REJECTED_BY_OM (terminal).
 */

// ---------------------------------------------------------------------
// TEMPLATE MANAGEMENT
// ---------------------------------------------------------------------

export const createEvaluationTemplateAction = withSecureAction({
  schema: createEvaluationTemplateSchema,
  resource: "evaluation_template",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "evaluation_templates",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: tpl, error } = await supabase
      .from("evaluation_templates")
      .insert({
        tenant_id: ctx.actor.tenantId,
        name: input.name,
        description: input.description ?? null,
        created_by: ctx.actor.employeeId,
      })
      .select("id")
      .single();
    if (error || !tpl) {
      throw new Error(error?.message ?? "Failed to create template.");
    }

    const itemsPayload = input.items.map((it) => ({
      tenant_id: ctx.actor.tenantId,
      template_id: tpl.id,
      seq: it.seq,
      name: it.name,
      description: it.description ?? null,
      weight_pct: it.weight_pct,
      question_type: it.question_type,
      is_required: it.is_required,
    }));
    if (itemsPayload.length > 0) {
      const { error: iErr } = await supabase
        .from("evaluation_template_items")
        .insert(itemsPayload);
      if (iErr) {
        // Compensating delete — keep master data consistent.
        await supabase.from("evaluation_templates").delete().eq("id", tpl.id);
        throw new Error(iErr.message);
      }
    }

    revalidatePath("/hr/performance/templates");
    return {
      result: { id: tpl.id },
      auditResourceId: tpl.id,
      auditNewValues: { name: input.name, item_count: input.items.length },
    };
  },
});

export const updateEvaluationTemplateAction = withSecureAction({
  schema: updateEvaluationTemplateSchema,
  resource: "evaluation_template",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "evaluation_templates",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { error: upErr } = await supabase
      .from("evaluation_templates")
      .update({
        name: input.name,
        description: input.description ?? null,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (upErr) throw new Error(upErr.message);

    // Replace items wholesale — simplest to keep the seq / weight totals
    // consistent. Any evaluations already linked to an old item still
    // work because `evaluation_answers.item_id` is not cascaded.
    await supabase
      .from("evaluation_template_items")
      .delete()
      .eq("template_id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);

    const itemsPayload = input.items.map((it) => ({
      tenant_id: ctx.actor.tenantId,
      template_id: input.id,
      seq: it.seq,
      name: it.name,
      description: it.description ?? null,
      weight_pct: it.weight_pct,
      question_type: it.question_type,
      is_required: it.is_required,
    }));
    if (itemsPayload.length > 0) {
      const { error: iErr } = await supabase
        .from("evaluation_template_items")
        .insert(itemsPayload);
      if (iErr) throw new Error(iErr.message);
    }

    revalidatePath("/hr/performance/templates");
    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditNewValues: { name: input.name, item_count: input.items.length },
    };
  },
});

export const toggleEvaluationTemplateActiveAction = withSecureAction({
  schema: toggleEvaluationTemplateActiveSchema,
  resource: "evaluation_template",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "evaluation_templates",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("evaluation_templates")
      .update({ is_active: input.is_active })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/performance/templates");
    return {
      result: { id: input.id, is_active: input.is_active },
      auditResourceId: input.id,
      auditNewValues: { is_active: input.is_active },
    };
  },
});

// ---------------------------------------------------------------------
// EVALUATION WORKFLOW
// ---------------------------------------------------------------------

/**
 * SPV starts a new evaluation. Auto-fills PM / OM from
 * `employees.reports_to_employee_id` when not provided (walks up 2
 * levels: employee → SPV → PM → OM).
 */
export const startEvaluationAction = withSecureAction({
  schema: startEvaluationSchema,
  resource: "evaluation",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "performance_evaluations",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select(
        "id, tenant_id, employment_type, contract_end_date, reports_to_employee_id, full_name",
      )
      .eq("id", input.employee_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (empErr || !emp) throw new Error("Employee not found.");

    // Guardrail — evaluation is only meaningful for non-permanent
    // staff with a fixed contract end date.
    if (emp.employment_type === "PERMANENT") {
      throw new Error(
        "Evaluations are only for non-permanent employees (Contract / Probation / Intern / Outsource).",
      );
    }
    if (!emp.contract_end_date) {
      throw new Error(
        "Employee has no contract end date — set it in HR › Employees first.",
      );
    }

    // De-duplicate: refuse if there's already an open evaluation for
    // this employee (any non-terminal status).
    const { count: openCount } = await supabase
      .from("performance_evaluations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("employee_id", emp.id)
      .not("status", "in", "(FINALIZED,REJECTED_BY_OM)");
    if ((openCount ?? 0) > 0) {
      throw new Error(
        "An open evaluation already exists for this employee.",
      );
    }

    // Verify the template is active for this tenant.
    const { data: tpl, error: tplErr } = await supabase
      .from("evaluation_templates")
      .select("id, is_active")
      .eq("id", input.template_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (tplErr || !tpl || !tpl.is_active) {
      throw new Error("Template is not active or not accessible.");
    }

    // Auto-resolve PM / OM if not passed. Walk employees.reports_to
    // chain twice; if roles do not match we leave the slot null and
    // let HR fill it in later.
    let pmEmpId = input.pm_employee_id ?? null;
    let omEmpId = input.om_employee_id ?? null;
    if (!pmEmpId && emp.reports_to_employee_id) {
      const { data: mgr1 } = await supabase
        .from("employees")
        .select("id, role, reports_to_employee_id")
        .eq("id", emp.reports_to_employee_id)
        .maybeSingle();
      if (mgr1?.role === "PROJECT_MANAGER") pmEmpId = mgr1.id;
      if (mgr1?.reports_to_employee_id && !omEmpId) {
        const { data: mgr2 } = await supabase
          .from("employees")
          .select("id, role")
          .eq("id", mgr1.reports_to_employee_id)
          .maybeSingle();
        if (
          mgr2?.role === "OPERATIONS_MANAGER" ||
          mgr2?.role === "HEAD_MANAGER"
        ) {
          omEmpId = mgr2.id;
        }
      }
    }

    const { data: inserted, error: insErr } = await supabase
      .from("performance_evaluations")
      .insert({
        tenant_id: ctx.actor.tenantId,
        employee_id: emp.id,
        template_id: input.template_id,
        contract_end_date: emp.contract_end_date,
        spv_employee_id: ctx.actor.employeeId,
        pm_employee_id: pmEmpId,
        om_employee_id: omEmpId,
        status: "DRAFT" as EvaluationStatus,
        period_start_date: input.period_start_date ?? null,
        period_end_date: input.period_end_date ?? null,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw new Error(insErr?.message ?? "Failed to create evaluation.");
    }

    revalidatePath("/hr/performance");
    return {
      result: { id: inserted.id },
      auditResourceId: inserted.id,
      auditNewValues: {
        employee_id: emp.id,
        template_id: input.template_id,
        contract_end_date: emp.contract_end_date,
      },
    };
  },
});

/**
 * Upsert one answer at a time (form save-on-blur UX). Enforced only
 * while the eval is still DRAFT or RETURNED_TO_SPV — later stages
 * are read-only for SPV.
 */
export const upsertEvaluationAnswerAction = withSecureAction({
  schema: upsertEvaluationAnswerSchema,
  resource: "evaluation",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "evaluation_answers",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: parent, error: pErr } = await supabase
      .from("performance_evaluations")
      .select("id, status, spv_employee_id")
      .eq("id", input.evaluation_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (pErr || !parent) throw new Error("Evaluation not found.");
    if (parent.spv_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the assigned SPV may edit answers.");
    }
    if (
      parent.status !== "DRAFT" &&
      parent.status !== "RETURNED_TO_SPV"
    ) {
      throw new Error(
        `Answers are locked at status ${parent.status}. Return the evaluation to SPV first.`,
      );
    }

    // Upsert on (evaluation_id, item_id). Score / text are mutually
    // exclusive but we let the trigger + item.question_type sort it out.
    const { error } = await supabase.from("evaluation_answers").upsert(
      {
        tenant_id: ctx.actor.tenantId,
        evaluation_id: input.evaluation_id,
        item_id: input.item_id,
        numeric_score: input.numeric_score ?? null,
        text_answer: input.text_answer ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "evaluation_id,item_id" },
    );
    if (error) throw new Error(error.message);

    revalidatePath(`/hr/performance/${input.evaluation_id}`);
    return {
      result: { evaluation_id: input.evaluation_id, item_id: input.item_id },
      auditResourceId: input.evaluation_id,
      auditNewValues: {
        item_id: input.item_id,
        numeric_score: input.numeric_score,
      },
    };
  },
});

/**
 * SPV updates evaluation-level metadata (period, PKWT narratives,
 * external goal/competency percentages). Editable only while the row
 * is DRAFT or RETURNED_TO_SPV — after submit the SPV cannot mutate
 * these fields.
 */
export const updateEvaluationMetaAction = withSecureAction({
  schema: updateEvaluationMetaSchema,
  resource: "evaluation",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "performance_evaluations",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: parent, error } = await supabase
      .from("performance_evaluations")
      .select("id, status, spv_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Evaluation not found.");
    if (parent.spv_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the assigned SPV may edit this evaluation.");
    }
    if (parent.status !== "DRAFT" && parent.status !== "RETURNED_TO_SPV") {
      throw new Error(`Cannot edit metadata at status ${parent.status}.`);
    }

    // Build patch — only include keys the caller actually passed so
    // we don't null-out fields unintentionally when the form only
    // updates a subset. Typed as `TablesUpdate` so the Supabase client
    // gets the exact-key contract it needs.
    const patch: TablesUpdate<"performance_evaluations"> = {};
    if (input.period_start_date !== undefined)
      patch.period_start_date = input.period_start_date;
    if (input.period_end_date !== undefined)
      patch.period_end_date = input.period_end_date;
    if (input.strengths !== undefined) patch.strengths = input.strengths;
    if (input.dev_areas !== undefined) patch.dev_areas = input.dev_areas;
    if (input.dev_proposal !== undefined)
      patch.dev_proposal = input.dev_proposal;
    if (input.goal_achievement_pct !== undefined)
      patch.goal_achievement_pct = input.goal_achievement_pct;
    if (input.competency_meet_pct !== undefined)
      patch.competency_meet_pct = input.competency_meet_pct;
    if (input.is_final_period !== undefined)
      patch.is_final_period = input.is_final_period;

    if (Object.keys(patch).length === 0) {
      return {
        result: { id: parent.id },
        auditResourceId: parent.id,
      };
    }

    const { error: uErr } = await supabase
      .from("performance_evaluations")
      .update(patch)
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    revalidatePath(`/hr/performance/${parent.id}`);
    return {
      result: { id: parent.id },
      auditResourceId: parent.id,
      auditNewValues: patch,
    };
  },
});

/**
 * SPV submits the completed evaluation. Requires: all required items
 * answered. Transitions DRAFT / RETURNED_TO_SPV → SUBMITTED_BY_SPV
 * and notifies the PM.
 */
export const submitEvaluationBySpvAction = withSecureAction({
  schema: submitEvaluationBySpvSchema,
  resource: "evaluation",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "performance_evaluations",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: parent, error } = await supabase
      .from("performance_evaluations")
      .select(
        "id, status, spv_employee_id, pm_employee_id, template_id, employee_id, contract_end_date",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Evaluation not found.");
    if (parent.spv_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the assigned SPV may submit.");
    }
    if (parent.status !== "DRAFT" && parent.status !== "RETURNED_TO_SPV") {
      throw new Error(`Cannot submit from status ${parent.status}.`);
    }

    // Check all required items are answered.
    const { data: items } = await supabase
      .from("evaluation_template_items")
      .select("id, is_required, question_type")
      .eq("template_id", parent.template_id)
      .eq("tenant_id", ctx.actor.tenantId);
    const { data: answers } = await supabase
      .from("evaluation_answers")
      .select("item_id, numeric_score, text_answer")
      .eq("evaluation_id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);

    const answerByItem = new Map(
      (answers ?? []).map((a) => [a.item_id, a] as const),
    );
    // Required-item completeness. PKWT form convention: a SCORE_1_5
    // item that is `is_required` needs BOTH a numeric score AND a
    // comment (`text_answer` used as "Komentar"). TEXT items need
    // only a non-empty answer.
    const missingScore: string[] = [];
    const missingComment: string[] = [];
    const missingText: string[] = [];
    for (const it of items ?? []) {
      if (!it.is_required) continue;
      const a = answerByItem.get(it.id);
      if (it.question_type === "SCORE_1_5") {
        if (a?.numeric_score === null || a?.numeric_score === undefined) {
          missingScore.push(it.id);
        } else if (!a.text_answer || a.text_answer.trim().length === 0) {
          missingComment.push(it.id);
        }
      } else if (!a?.text_answer || a.text_answer.trim().length === 0) {
        missingText.push(it.id);
      }
    }
    if (
      missingScore.length > 0 ||
      missingComment.length > 0 ||
      missingText.length > 0
    ) {
      const parts: string[] = [];
      if (missingScore.length) parts.push(`${missingScore.length} skor`);
      if (missingComment.length) parts.push(`${missingComment.length} komentar`);
      if (missingText.length) parts.push(`${missingText.length} isian teks`);
      throw new Error(
        `Please complete all required items before submitting — missing ${parts.join(", ")}.`,
      );
    }

    // Snapshot the SPV's manually-entered extension end date. We keep
    // `contract_extension_months` as a derived display value (whole
    // months between old end and new end) so downstream cards can
    // render "+3 bln → 2026-04-30" without re-computing. When the
    // recommendation is NOT_EXTEND we explicitly null both fields so
    // previously-drafted extensions don't linger on the row.
    let extensionMonths: number | null = null;
    let extensionEndDate: string | null = null;
    if (input.spv_recommendation === "EXTEND") {
      const raw = input.contract_extension_end_date ?? null;
      if (!raw) {
        // Belt-and-suspenders — the Zod refine already catches this
        // path but a hand-crafted SDK caller could still slip a null
        // through the wire.
        throw new Error("Isi tanggal akhir kontrak baru.");
      }
      // Reject any date that is not strictly after the current
      // contract end. Silently coercing this would let SPVs "extend"
      // backwards which would be a footgun for Finance / HR later.
      if (raw <= parent.contract_end_date) {
        throw new Error(
          "Tanggal akhir kontrak baru harus setelah tanggal akhir kontrak sekarang.",
        );
      }
      extensionEndDate = raw;
      extensionMonths = deriveExtensionMonths(
        parent.contract_end_date,
        raw,
      );
    }

    const nowIso = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("performance_evaluations")
      .update({
        status: "SUBMITTED_BY_SPV",
        spv_recommendation: input.spv_recommendation,
        contract_extension_months: extensionMonths,
        contract_extension_end_date: extensionEndDate,
        spv_notes: input.spv_notes ?? null,
        submitted_at: nowIso,
      })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Notify PM (if assigned) — else broadcast to PM role.
    if (parent.pm_employee_id) {
      const { data: pmUser } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", parent.pm_employee_id)
        .maybeSingle();
      if (pmUser?.user_id) {
        const { t } = await translatorFor({
          employeeId: parent.pm_employee_id,
          namespace: "notifications.evaluations",
        });
        await notifyUser({
          recipient: {
            userId: pmUser.user_id,
            employeeId: parent.pm_employee_id,
          },
          kind: "EVALUATION_SUBMITTED",
          title: t("submittedTitle"),
          body: t("submittedBody"),
          actionUrl: `/hr/performance/${parent.id}`,
          payload: { evaluation_id: parent.id },
        });
      }
    } else {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["PROJECT_MANAGER"],
        kind: "EVALUATION_SUBMITTED",
        title: "New evaluation submitted for review",
        actionUrl: `/hr/performance/${parent.id}`,
        payload: { evaluation_id: parent.id },
      });
    }

    revalidatePath("/hr/performance");
    revalidatePath(`/hr/performance/${parent.id}`);
    return {
      result: {
        id: parent.id,
        status: "SUBMITTED_BY_SPV" as const,
        contract_extension_end_date: extensionEndDate,
      },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: {
        status: "SUBMITTED_BY_SPV",
        spv_recommendation: input.spv_recommendation,
        contract_extension_months: extensionMonths,
        contract_extension_end_date: extensionEndDate,
      },
    };
  },
});

/** PM reviews — APPROVE forwards to OM, RETURN bounces to SPV. */
export const reviewEvaluationByPmAction = withSecureAction({
  schema: reviewEvaluationByPmSchema,
  resource: "evaluation",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "performance_evaluations",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: parent, error } = await supabase
      .from("performance_evaluations")
      .select("id, status, pm_employee_id, spv_employee_id, om_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Evaluation not found.");
    // PM identity check — either the assigned PM or HR/Admin. Others
    // are blocked by PDP already.
    if (
      parent.pm_employee_id &&
      parent.pm_employee_id !== ctx.actor.employeeId
    ) {
      // Fall through only for HR/Mgmt (they can act on any row).
      // PDP allowed us here; identity mismatch means we should refuse
      // unless the caller is not a PM (i.e. an override role).
      // We keep it strict for cleanliness — if PM is assigned, only
      // that PM may act. HR can reassign first.
      throw new Error(
        "This evaluation is assigned to a different PM. Ask HR to reassign.",
      );
    }
    if (parent.status !== "SUBMITTED_BY_SPV") {
      throw new Error(
        `PM review is only valid from SUBMITTED_BY_SPV (current: ${parent.status}).`,
      );
    }

    const nowIso = new Date().toISOString();
    if (input.decision === "APPROVE") {
      const { error: uErr } = await supabase
        .from("performance_evaluations")
        .update({
          status: "REVIEWED_BY_PM",
          pm_notes: input.pm_notes ?? null,
          pm_reviewed_at: nowIso,
          pm_employee_id: parent.pm_employee_id ?? ctx.actor.employeeId,
        })
        .eq("id", parent.id)
        .eq("tenant_id", ctx.actor.tenantId);
      if (uErr) throw new Error(uErr.message);

      // Notify OM if assigned, else broadcast to OM role.
      if (parent.om_employee_id) {
        const { data: omUser } = await supabase
          .from("employees")
          .select("user_id")
          .eq("id", parent.om_employee_id)
          .maybeSingle();
        if (omUser?.user_id) {
          const { t } = await translatorFor({
            employeeId: parent.om_employee_id,
            namespace: "notifications.evaluations",
          });
          await notifyUser({
            recipient: {
              userId: omUser.user_id,
              employeeId: parent.om_employee_id,
            },
            kind: "EVALUATION_REVIEWED",
            title: t("reviewedTitle"),
            body: t("reviewedBody"),
            actionUrl: `/hr/performance/${parent.id}`,
            payload: { evaluation_id: parent.id },
          });
        }
      } else {
        await notifyRoles({
          tenantId: ctx.actor.tenantId,
          roles: ["OPERATIONS_MANAGER", "HEAD_MANAGER"],
          kind: "EVALUATION_REVIEWED",
          title: "Evaluation ready for OM decision",
          actionUrl: `/hr/performance/${parent.id}`,
          payload: { evaluation_id: parent.id },
        });
      }
    } else {
      // RETURN — bounce back to SPV for coaching.
      const { error: uErr } = await supabase
        .from("performance_evaluations")
        .update({
          status: "RETURNED_TO_SPV",
          pm_notes: input.pm_notes ?? null,
          pm_reviewed_at: nowIso,
        })
        .eq("id", parent.id)
        .eq("tenant_id", ctx.actor.tenantId);
      if (uErr) throw new Error(uErr.message);

      const { data: spvUser } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", parent.spv_employee_id)
        .maybeSingle();
      if (spvUser?.user_id) {
        const { t } = await translatorFor({
          employeeId: parent.spv_employee_id,
          namespace: "notifications.evaluations",
        });
        await notifyUser({
          recipient: {
            userId: spvUser.user_id,
            employeeId: parent.spv_employee_id,
          },
          kind: "EVALUATION_RETURNED",
          title: t("returnedTitle"),
          body: input.pm_notes ?? t("returnedBody"),
          actionUrl: `/hr/performance/${parent.id}`,
          payload: { evaluation_id: parent.id },
        });
      }
    }

    revalidatePath("/hr/performance");
    revalidatePath(`/hr/performance/${parent.id}`);
    return {
      result: { id: parent.id, decision: input.decision },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: {
        status:
          input.decision === "APPROVE" ? "REVIEWED_BY_PM" : "RETURNED_TO_SPV",
      },
    };
  },
});

/**
 * OM decides — APPROVE finalizes; on NOT_EXTEND recommendation we
 * auto-create a UPK draft note tied to this eval. REJECT is terminal.
 */
export const decideEvaluationByOmAction = withSecureAction({
  schema: decideEvaluationByOmSchema,
  resource: "evaluation",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "performance_evaluations",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: parent, error } = await supabase
      .from("performance_evaluations")
      .select(
        "id, status, spv_employee_id, pm_employee_id, om_employee_id, employee_id, contract_end_date, spv_recommendation",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Evaluation not found.");
    if (parent.status !== "REVIEWED_BY_PM") {
      throw new Error(
        `OM decision valid only from REVIEWED_BY_PM (current: ${parent.status}).`,
      );
    }

    const nowIso = new Date().toISOString();
    const newStatus =
      input.decision === "APPROVE" ? "FINALIZED" : "REJECTED_BY_OM";
    const { error: uErr } = await supabase
      .from("performance_evaluations")
      .update({
        status: newStatus,
        om_notes: input.om_notes ?? null,
        om_decided_at: nowIso,
        om_employee_id: parent.om_employee_id ?? ctx.actor.employeeId,
        finalized_at: input.decision === "APPROVE" ? nowIso : null,
      })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Auto-generate UPK draft if OM approved AND SPV recommended
    // NOT_EXTEND. Best-effort — failure here should not block the OM
    // decision.
    let spawnedUpkId: string | null = null;
    if (
      input.decision === "APPROVE" &&
      parent.spv_recommendation === "NOT_EXTEND"
    ) {
      try {
        const { data: emp } = await supabase
          .from("employees")
          .select("id, join_date, monthly_salary")
          .eq("id", parent.employee_id)
          .maybeSingle();
        const monthlySalary = Number(emp?.monthly_salary ?? 0);
        const joinDate = emp?.join_date ? new Date(emp.join_date) : null;
        const endDate = new Date(parent.contract_end_date);
        const serviceMonths = joinDate
          ? Math.max(
              0,
              Math.round(
                (endDate.getTime() - joinDate.getTime()) /
                  (1000 * 60 * 60 * 24 * 30.4375),
              ),
            )
          : 0;
        const computed = computeUpkAmount({
          baseSalaryIdr: monthlySalary,
          serviceMonths,
          multiplier: 1,
        });
        const { data: upk } = await supabase
          .from("upk_notes")
          .insert({
            tenant_id: ctx.actor.tenantId,
            employee_id: parent.employee_id,
            evaluation_id: parent.id,
            contract_end_date: parent.contract_end_date,
            service_months: serviceMonths,
            base_salary: monthlySalary,
            multiplier: 1,
            computed_upk: computed,
            drafted_by: parent.pm_employee_id ?? ctx.actor.employeeId,
            status: "DRAFT",
          })
          .select("id")
          .single();
        spawnedUpkId = upk?.id ?? null;

        // Notify PM to complete the UPK draft.
        if (parent.pm_employee_id) {
          const { data: pmUser } = await supabase
            .from("employees")
            .select("user_id")
            .eq("id", parent.pm_employee_id)
            .maybeSingle();
          if (pmUser?.user_id && spawnedUpkId) {
            const { t } = await translatorFor({
              employeeId: parent.pm_employee_id,
              namespace: "notifications.upk",
            });
            await notifyUser({
              recipient: {
                userId: pmUser.user_id,
                employeeId: parent.pm_employee_id,
              },
              kind: "UPK_DRAFT_CREATED",
              title: t("draftTitle"),
              body: t("draftBody"),
              actionUrl: `/hr/upk/${spawnedUpkId}`,
              payload: { upk_id: spawnedUpkId, evaluation_id: parent.id },
            });
          }
        }
      } catch {
        // Swallow — UPK failure should not block the finalization.
      }
    }

    // Notify SPV (final outcome).
    const { data: spvUser } = await supabase
      .from("employees")
      .select("user_id")
      .eq("id", parent.spv_employee_id)
      .maybeSingle();
    if (spvUser?.user_id) {
      const { t } = await translatorFor({
        employeeId: parent.spv_employee_id,
        namespace: "notifications.evaluations",
      });
      const kind = input.decision === "APPROVE"
        ? ("EVALUATION_APPROVED" as const)
        : ("EVALUATION_REJECTED" as const);
      await notifyUser({
        recipient: {
          userId: spvUser.user_id,
          employeeId: parent.spv_employee_id,
        },
        kind,
        title:
          input.decision === "APPROVE"
            ? t("approvedTitle")
            : t("rejectedTitle"),
        body: input.om_notes ?? undefined,
        actionUrl: `/hr/performance/${parent.id}`,
        payload: { evaluation_id: parent.id },
      });
    }

    revalidatePath("/hr/performance");
    revalidatePath(`/hr/performance/${parent.id}`);
    return {
      result: { id: parent.id, status: newStatus, upk_id: spawnedUpkId },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: { status: newStatus, upk_id: spawnedUpkId },
    };
  },
});
