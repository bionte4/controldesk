"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import {
  canApproveNextPmh,
  nextPmHandoverStatus,
} from "@/lib/handover/state";
import {
  approvePmHandoverSchema,
  cancelPmHandoverSchema,
  executePmHandoverSchema,
  rejectPmHandoverSchema,
  submitPmHandoverSchema,
} from "@/lib/validation/handover";
import type {
  PmHandoverStatus,
  TablesUpdate,
} from "@/types/database";

// ---------------------------------------------------------------------------
// SUBMIT — OM+ initiates handover
// ---------------------------------------------------------------------------
export const submitPmHandoverAction = withSecureAction({
  schema: submitPmHandoverSchema,
  resource: "pm_handover",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "pm_handovers",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: inserted, error: insertErr } = await supabase
      .from("pm_handovers")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        from_pm_employee_id: input.from_pm_employee_id,
        to_pm_employee_id: input.to_pm_employee_id,
        effective_at: input.effective_at,
        reason: input.reason,
        handover_notes: input.handover_notes ?? null,
        initiated_by: ctx.actor.employeeId,
        status: "PENDING_OM",
      })
      .select("id, project_id, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to submit handover.");
    }

    const { error: logErr } = await supabase
      .from("pm_handover_audit_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        handover_id: inserted.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "SUBMIT",
        from_status: "DRAFT",
        to_status: "PENDING_OM",
      });
    if (logErr) throw new Error(logErr.message);

    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["OPERATIONS_MANAGER", "TENANT_ADMIN"],
      kind: "PROJECT_HANDOVER",
      title: "PM handover awaiting your approval",
      body: input.reason.slice(0, 200),
      actionUrl: `/handovers/${inserted.id}`,
      payload: { handover_id: inserted.id, project_id: inserted.project_id },
    });

    revalidatePath("/handovers");

    return {
      result: { id: inserted.id, status: inserted.status },
      auditResourceId: inserted.id,
      auditNewValues: {
        project_id: inserted.project_id,
        status: inserted.status,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// APPROVE — OM (L1) or HM (L2)
// ---------------------------------------------------------------------------
export const approvePmHandoverAction = withSecureAction({
  schema: approvePmHandoverSchema,
  resource: "pm_handover",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "pm_handovers",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("pm_handovers")
      .select("status, initiated_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.initiated_by ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("pm_handovers")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Handover not found.");

    const currentStatus = current.status as PmHandoverStatus;
    if (!canApproveNextPmh(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot approve status ${currentStatus}.`,
      );
    }

    const toStatus = nextPmHandoverStatus({
      current: currentStatus,
      action: "APPROVE",
    });

    const patch: TablesUpdate<"pm_handovers"> = { status: toStatus };
    if (currentStatus === "PENDING_OM") {
      patch.om_approved_at = new Date().toISOString();
      patch.om_approver_id = ctx.actor.employeeId;
    } else if (currentStatus === "PENDING_HM") {
      patch.hm_approved_at = new Date().toISOString();
      patch.hm_approver_id = ctx.actor.employeeId;
    }

    const { error: updateErr } = await supabase
      .from("pm_handovers")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("pm_handover_audit_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        handover_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "APPROVE",
        from_status: currentStatus,
        to_status: toStatus,
        comment: input.comment ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    if (toStatus === "PENDING_HM") {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["HEAD_MANAGER", "TENANT_ADMIN"],
        kind: "PROJECT_HANDOVER",
        title: "PM handover awaiting HM approval",
        actionUrl: `/handovers/${input.id}`,
      });
    } else if (toStatus === "APPROVED") {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: [
          "OPERATIONS_MANAGER",
          "HEAD_MANAGER",
          "GENERAL_MANAGER",
          "TENANT_ADMIN",
        ],
        kind: "PROJECT_HANDOVER",
        title: "PM handover approved — ready to execute",
        actionUrl: `/handovers/${input.id}`,
      });
    }

    revalidatePath("/handovers");
    revalidatePath(`/handovers/${input.id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: toStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: toStatus },
    };
  },
});

// ---------------------------------------------------------------------------
// REJECT
// ---------------------------------------------------------------------------
export const rejectPmHandoverAction = withSecureAction({
  schema: rejectPmHandoverSchema,
  resource: "pm_handover",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "pm_handovers",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("pm_handovers")
      .select("status, initiated_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.initiated_by ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("pm_handovers")
      .select("id, status, initiated_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Handover not found.");

    const currentStatus = current.status as PmHandoverStatus;
    if (!canApproveNextPmh(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot reject at status ${currentStatus}.`,
      );
    }

    const { error: updateErr } = await supabase
      .from("pm_handovers")
      .update({
        status: "REJECTED",
        rejected_at: new Date().toISOString(),
        rejected_by: ctx.actor.employeeId,
        rejection_reason: input.reason,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("pm_handover_audit_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        handover_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "REJECT",
        from_status: currentStatus,
        to_status: "REJECTED",
        comment: input.reason,
      });
    if (logErr) throw new Error(logErr.message);

    const { data: initiator } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.initiated_by)
      .maybeSingle();
    if (initiator) {
      await notifyUser({
        recipient: { userId: initiator.user_id, employeeId: initiator.id },
        kind: "APPROVAL_REJECTED",
        title: "PM handover rejected",
        body: input.reason,
        actionUrl: `/handovers/${input.id}`,
      });
    }

    revalidatePath("/handovers");
    revalidatePath(`/handovers/${input.id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: "REJECTED" as PmHandoverStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: "REJECTED", reason: input.reason },
    };
  },
});

// ---------------------------------------------------------------------------
// CANCEL — initiator or OM+
// ---------------------------------------------------------------------------
export const cancelPmHandoverAction = withSecureAction({
  schema: cancelPmHandoverSchema,
  resource: "pm_handover",
  action: "cancel",
  auditAction: "CANCEL",
  auditResourceName: "pm_handovers",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("pm_handovers")
      .select("status, initiated_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.initiated_by ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("pm_handovers")
      .select("id, status")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Handover not found.");

    const currentStatus = current.status as PmHandoverStatus;
    if (
      currentStatus === "EXECUTED" ||
      currentStatus === "REJECTED" ||
      currentStatus === "CANCELLED"
    ) {
      throw new Error("Cannot cancel a terminal handover.");
    }

    const { error: updateErr } = await supabase
      .from("pm_handovers")
      .update({ status: "CANCELLED" })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("pm_handover_audit_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        handover_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "CANCEL",
        from_status: currentStatus,
        to_status: "CANCELLED",
        comment: input.reason ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    revalidatePath("/handovers");
    revalidatePath(`/handovers/${input.id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: "CANCELLED" as PmHandoverStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: "CANCELLED" },
    };
  },
});

// ---------------------------------------------------------------------------
// EXECUTE — atomically transfers the PRIMARY_PM assignment
// ---------------------------------------------------------------------------
export const executePmHandoverAction = withSecureAction({
  schema: executePmHandoverSchema,
  resource: "pm_handover",
  action: "settle",
  auditAction: "APPROVE",
  auditResourceName: "pm_handovers",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("pm_handovers")
      .select("status, initiated_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.initiated_by ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("pm_handovers")
      .select("id, status, project_id, to_pm_employee_id, initiated_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Handover not found.");
    if (current.status !== "APPROVED") {
      throw new Error(
        `Handover must be APPROVED to execute (current=${current.status}).`,
      );
    }

    const { error: rpcErr } = await supabase.rpc("finalise_pm_handover", {
      p_handover_id: input.id,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    const { data: initiator } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.initiated_by)
      .maybeSingle();
    if (initiator) {
      await notifyUser({
        recipient: { userId: initiator.user_id, employeeId: initiator.id },
        kind: "PROJECT_HANDOVER",
        title: "PM handover executed",
        actionUrl: `/handovers/${input.id}`,
      });
    }
    // Notify incoming PM
    const { data: incoming } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.to_pm_employee_id)
      .maybeSingle();
    if (incoming) {
      await notifyUser({
        recipient: { userId: incoming.user_id, employeeId: incoming.id },
        kind: "PROJECT_HANDOVER",
        title: "You are the new Primary PM",
        actionUrl: `/projects/${current.project_id}`,
      });
    }

    revalidatePath("/handovers");
    revalidatePath(`/handovers/${input.id}`);
    revalidatePath("/projects");
    revalidatePath(`/projects/${current.project_id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: "EXECUTED" as PmHandoverStatus },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: {
        status: "EXECUTED",
        project_id: current.project_id,
        to_pm_employee_id: current.to_pm_employee_id,
      },
    };
  },
});
