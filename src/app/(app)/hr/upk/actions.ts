"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { translatorFor } from "@/lib/notifications/localize";
import {
  computeUpkAmount,
  createUpkNoteSchema,
  decideUpkNoteSchema,
  markUpkPaidSchema,
  submitUpkNoteSchema,
  UPK_DIRECTOR_THRESHOLD_IDR,
  updateUpkNoteSchema,
  type UpkStatus,
} from "@/lib/validation/upk";
import type { TablesUpdate } from "@/types/database";

/**
 * UPK (Uang Penghentian Kontrak / severance) workflow.
 *
 *   PM draft ─ submit ─▶ PENDING_FINANCE
 *                        ├─ approve (< 50M) ─▶ APPROVED
 *                        ├─ approve (≥ 50M) ─▶ PENDING_DIRECTOR ─ approve ─▶ APPROVED
 *                        └─ reject ─▶ REJECTED_BY_FINANCE
 *   APPROVED ─ mark paid ─▶ PAID
 */

// ---------------------------------------------------------------------
// CREATE / EDIT DRAFT
// ---------------------------------------------------------------------

export const createUpkNoteAction = withSecureAction({
  schema: createUpkNoteSchema,
  resource: "upk_note",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "upk_notes",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const computed = computeUpkAmount({
      baseSalaryIdr: input.base_salary_idr,
      serviceMonths: input.service_months,
      multiplier: input.multiplier,
    });
    const { data, error } = await supabase
      .from("upk_notes")
      .insert({
        tenant_id: ctx.actor.tenantId,
        employee_id: input.employee_id,
        evaluation_id: input.evaluation_id ?? null,
        contract_end_date: input.contract_end_date,
        service_months: input.service_months,
        base_salary: input.base_salary_idr,
        multiplier: input.multiplier,
        computed_upk: computed,
        justification: input.justification ?? null,
        drafted_by: ctx.actor.employeeId,
        status: "DRAFT",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "UPK draft failed.");

    revalidatePath("/hr/upk");
    return {
      result: { id: data.id },
      auditResourceId: data.id,
      auditNewValues: {
        employee_id: input.employee_id,
        computed_upk: computed,
      },
    };
  },
});

export const updateUpkNoteAction = withSecureAction({
  schema: updateUpkNoteSchema,
  resource: "upk_note",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "upk_notes",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("upk_notes")
      .select(
        "id, status, base_salary, service_months, multiplier, computed_upk",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("UPK note not found.");
    if (existing.status !== "DRAFT") {
      throw new Error(`Cannot edit at status ${existing.status}.`);
    }

    const nextBase =
      input.base_salary_idr !== undefined
        ? input.base_salary_idr
        : Number(existing.base_salary);
    const nextMonths =
      input.service_months !== undefined
        ? input.service_months
        : existing.service_months;
    const nextMult =
      input.multiplier !== undefined
        ? input.multiplier
        : Number(existing.multiplier);
    const nextComputed = computeUpkAmount({
      baseSalaryIdr: nextBase,
      serviceMonths: nextMonths,
      multiplier: nextMult,
    });

    const patch: TablesUpdate<"upk_notes"> = { computed_upk: nextComputed };
    if (input.employee_id !== undefined) patch.employee_id = input.employee_id;
    if (input.evaluation_id !== undefined)
      patch.evaluation_id = input.evaluation_id;
    if (input.contract_end_date !== undefined)
      patch.contract_end_date = input.contract_end_date;
    if (input.service_months !== undefined)
      patch.service_months = input.service_months;
    if (input.base_salary_idr !== undefined)
      patch.base_salary = input.base_salary_idr;
    if (input.multiplier !== undefined) patch.multiplier = input.multiplier;
    if (input.justification !== undefined)
      patch.justification = input.justification ?? null;

    const { error } = await supabase
      .from("upk_notes")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath("/hr/upk");
    revalidatePath(`/hr/upk/${input.id}`);
    return {
      result: { id: input.id, computed_upk: nextComputed },
      auditResourceId: input.id,
      auditNewValues: { computed_upk: nextComputed },
    };
  },
});

// ---------------------------------------------------------------------
// SUBMIT → FINANCE
// ---------------------------------------------------------------------
export const submitUpkNoteAction = withSecureAction({
  schema: submitUpkNoteSchema,
  resource: "upk_note",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "upk_notes",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("upk_notes")
      .select("id, status, computed_upk, justification")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("UPK note not found.");
    if (parent.status !== "DRAFT")
      throw new Error(`Cannot submit at status ${parent.status}.`);
    if (Number(parent.computed_upk) <= 0)
      throw new Error("Computed UPK must be greater than 0.");
    if (!parent.justification || parent.justification.trim().length === 0) {
      throw new Error("Please add justification before submitting.");
    }

    const nowIso = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("upk_notes")
      .update({
        status: "PENDING_FINANCE" as UpkStatus,
        submitted_at: nowIso,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["LEAD_FINANCE"],
      kind: "UPK_SUBMITTED",
      title: "UPK draft pending finance approval",
      actionUrl: `/hr/upk/${input.id}`,
      payload: { upk_id: input.id },
    });

    revalidatePath("/hr/upk");
    revalidatePath(`/hr/upk/${input.id}`);
    return {
      result: { id: input.id, status: "PENDING_FINANCE" as const },
      auditResourceId: input.id,
      auditOldValues: { status: parent.status },
      auditNewValues: { status: "PENDING_FINANCE" },
    };
  },
});

// ---------------------------------------------------------------------
// FINANCE DECISION
// ---------------------------------------------------------------------
export const decideUpkByFinanceAction = withSecureAction({
  schema: decideUpkNoteSchema,
  resource: "upk_note",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "upk_notes",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("upk_notes")
      .select("id, status, computed_upk, drafted_by, employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("UPK note not found.");
    if (parent.status !== "PENDING_FINANCE") {
      throw new Error(
        `Finance decision valid only at PENDING_FINANCE (current: ${parent.status}).`,
      );
    }

    const nowIso = new Date().toISOString();
    let nextStatus: UpkStatus;
    if (input.decision === "REJECT") {
      nextStatus = "REJECTED_BY_FINANCE";
    } else if (Number(parent.computed_upk) >= UPK_DIRECTOR_THRESHOLD_IDR) {
      nextStatus = "PENDING_DIRECTOR";
    } else {
      nextStatus = "APPROVED";
    }

    const { error: uErr } = await supabase
      .from("upk_notes")
      .update({
        status: nextStatus,
        finance_approved_by: ctx.actor.employeeId,
        finance_approved_at: nowIso,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Notify drafter of the outcome.
    const { data: drafter } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", parent.drafted_by ?? "")
      .maybeSingle();
    if (drafter?.user_id) {
      const { t } = await translatorFor({
        employeeId: drafter.id,
        namespace: "notifications.upk",
      });
      await notifyUser({
        recipient: { userId: drafter.user_id, employeeId: drafter.id },
        kind:
          input.decision === "APPROVE"
            ? nextStatus === "APPROVED"
              ? "UPK_APPROVED"
              : "UPK_SUBMITTED"
            : "UPK_REJECTED",
        title: t(
          input.decision === "APPROVE"
            ? nextStatus === "APPROVED"
              ? "financeApprovedTitle"
              : "financeToDirectorTitle"
            : "financeRejectedTitle",
        ),
        body: input.notes ?? undefined,
        actionUrl: `/hr/upk/${input.id}`,
        payload: { upk_id: input.id },
      });
    }
    if (nextStatus === "PENDING_DIRECTOR") {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["GENERAL_MANAGER", "HEAD_MANAGER"],
        kind: "UPK_SUBMITTED",
        title: "UPK pending director approval",
        actionUrl: `/hr/upk/${input.id}`,
        payload: { upk_id: input.id },
      });
    }
    if (nextStatus === "APPROVED") {
      // Emit payroll-stop signal so external payroll can be halted.
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["LEAD_FINANCE", "HR_ADMIN"],
        kind: "PAYROLL_STOP_REQUEST",
        title: "Stop payroll requested",
        body: `UPK approved for employee ${parent.employee_id}. Please stop payroll.`,
        actionUrl: `/hr/upk/${input.id}`,
        payload: { upk_id: input.id, employee_id: parent.employee_id },
      });
    }

    revalidatePath("/hr/upk");
    revalidatePath(`/hr/upk/${input.id}`);
    return {
      result: { id: input.id, status: nextStatus },
      auditResourceId: input.id,
      auditOldValues: { status: parent.status },
      auditNewValues: { status: nextStatus, notes: input.notes },
    };
  },
});

// ---------------------------------------------------------------------
// DIRECTOR DECISION
// ---------------------------------------------------------------------
export const decideUpkByDirectorAction = withSecureAction({
  schema: decideUpkNoteSchema,
  resource: "upk_note",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "upk_notes",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("upk_notes")
      .select("id, status, drafted_by, employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("UPK note not found.");
    if (parent.status !== "PENDING_DIRECTOR") {
      throw new Error(
        `Director decision valid only at PENDING_DIRECTOR (current: ${parent.status}).`,
      );
    }

    const nowIso = new Date().toISOString();
    const nextStatus: UpkStatus =
      input.decision === "APPROVE" ? "APPROVED" : "REJECTED_BY_DIRECTOR";

    const { error: uErr } = await supabase
      .from("upk_notes")
      .update({
        status: nextStatus,
        director_approved_by: ctx.actor.employeeId,
        director_approved_at: nowIso,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    if (nextStatus === "APPROVED") {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["LEAD_FINANCE", "HR_ADMIN"],
        kind: "PAYROLL_STOP_REQUEST",
        title: "Stop payroll requested",
        body: `UPK approved for employee ${parent.employee_id}. Please stop payroll.`,
        actionUrl: `/hr/upk/${input.id}`,
        payload: { upk_id: input.id, employee_id: parent.employee_id },
      });
    }

    revalidatePath("/hr/upk");
    revalidatePath(`/hr/upk/${input.id}`);
    return {
      result: { id: input.id, status: nextStatus },
      auditResourceId: input.id,
      auditOldValues: { status: parent.status },
      auditNewValues: { status: nextStatus, notes: input.notes },
    };
  },
});

// ---------------------------------------------------------------------
// MARK PAID (Finance)
// ---------------------------------------------------------------------
export const markUpkPaidAction = withSecureAction({
  schema: markUpkPaidSchema,
  resource: "upk_note",
  action: "settle",
  auditAction: "UPDATE",
  auditResourceName: "upk_notes",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("upk_notes")
      .select("id, status, drafted_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("UPK note not found.");
    if (parent.status !== "APPROVED") {
      throw new Error(
        `Can only mark paid at APPROVED (current: ${parent.status}).`,
      );
    }

    const nowIso = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("upk_notes")
      .update({
        status: "PAID",
        paid_by: ctx.actor.employeeId,
        paid_at: nowIso,
        paid_reference: input.paid_reference ?? null,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Notify drafter that the money was disbursed.
    if (parent.drafted_by) {
      const { data: drafter } = await supabase
        .from("employees")
        .select("user_id, id")
        .eq("id", parent.drafted_by)
        .maybeSingle();
      if (drafter?.user_id) {
        const { t } = await translatorFor({
          employeeId: drafter.id,
          namespace: "notifications.upk",
        });
        await notifyUser({
          recipient: { userId: drafter.user_id, employeeId: drafter.id },
          kind: "UPK_PAID",
          title: t("paidTitle"),
          body: input.paid_reference ?? undefined,
          actionUrl: `/hr/upk/${input.id}`,
          payload: { upk_id: input.id },
        });
      }
    }

    revalidatePath("/hr/upk");
    revalidatePath(`/hr/upk/${input.id}`);
    return {
      result: { id: input.id, status: "PAID" as const },
      auditResourceId: input.id,
      auditOldValues: { status: parent.status },
      auditNewValues: { status: "PAID", paid_reference: input.paid_reference },
    };
  },
});
