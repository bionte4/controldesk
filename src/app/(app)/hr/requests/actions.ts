"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import {
  canApproveNextHr,
  expectedHrApproverRole,
  nextHrRequestStatus,
} from "@/lib/hris/state";
import {
  approveHrRequestSchema,
  cancelHrRequestSchema,
  rejectHrRequestSchema,
  submitHrRequestSchema,
} from "@/lib/validation/hris";
import type {
  ApprovalAction as ApprovalActionEnum,
  HrRequestStatus,
  TablesUpdate,
} from "@/types/database";

function statusToPdpLevel(status: HrRequestStatus) {
  switch (status) {
    case "PENDING_L1_SUPERVISOR":
      return "L1_SUPERVISOR" as const;
    case "PENDING_L2_PROJECT_MANAGER":
      return "L2_PROJECT_MANAGER" as const;
    case "PENDING_L3_OPERATIONS_MANAGER":
      return "L3_OPERATIONS_MANAGER" as const;
    case "PENDING_HR_ADMIN":
      return "L4_HEAD_MANAGER" as const; // reused as "final" bucket in PDP
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// SUBMIT
// ---------------------------------------------------------------------------
export const submitHrRequestAction = withSecureAction({
  schema: submitHrRequestSchema,
  resource: "hr_request",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "hr_requests",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: inserted, error: insertErr } = await supabase
      .from("hr_requests")
      .insert({
        tenant_id: ctx.actor.tenantId,
        requester_employee_id: ctx.actor.employeeId,
        kind: input.kind,
        project_id: input.project_id ?? null,
        leave_type: input.leave_type ?? null,
        start_at: input.start_at,
        end_at: input.end_at,
        hours_estimate: input.hours_estimate ?? null,
        reason: input.reason,
        attachment_url: input.attachment_url ?? null,
        status: "PENDING_L1_SUPERVISOR",
      })
      .select("id, kind, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to submit HR request.");
    }

    const { error: logErr } = await supabase.from("hr_approval_logs").insert({
      tenant_id: ctx.actor.tenantId,
      request_id: inserted.id,
      actor_employee_id: ctx.actor.employeeId,
      actor_role: ctx.actor.role,
      action: "SUBMIT",
      from_status: "DRAFT",
      to_status: "PENDING_L1_SUPERVISOR",
      comment: null,
    });
    if (logErr) throw new Error(logErr.message);

    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["SUPERVISOR", "TENANT_ADMIN"],
      kind: "APPROVAL_REQUESTED",
      title: `HR request awaiting L1 · ${input.kind}`,
      body: input.reason.slice(0, 200),
      actionUrl: `/hr/requests/${inserted.id}`,
      payload: { request_id: inserted.id, kind: inserted.kind },
    });

    revalidatePath("/hr/requests");
    revalidatePath("/approvals");

    return {
      result: { id: inserted.id, status: inserted.status },
      auditResourceId: inserted.id,
      auditNewValues: {
        kind: inserted.kind,
        status: inserted.status,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// APPROVE — advance state machine
// ---------------------------------------------------------------------------
export const approveHrRequestAction = withSecureAction({
  schema: approveHrRequestSchema,
  resource: "hr_request",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "hr_requests",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("hr_requests")
      .select("status, requester_employee_id, kind")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();

    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
      pendingApprovalLevel: row
        ? statusToPdpLevel(row.status as HrRequestStatus)
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("hr_requests")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("HR request not found.");

    const currentStatus = current.status as HrRequestStatus;
    if (!canApproveNextHr(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot approve status ${currentStatus}.`,
      );
    }

    const action: ApprovalActionEnum = "APPROVE";
    const toStatus = nextHrRequestStatus({
      kind: current.kind,
      current: currentStatus,
      action,
    });

    const updatePatch: TablesUpdate<"hr_requests"> = { status: toStatus };
    if (toStatus === "APPROVED") {
      updatePatch.final_approved_at = new Date().toISOString();
      updatePatch.final_approver_id = ctx.actor.employeeId;
    }

    const { error: updateErr } = await supabase
      .from("hr_requests")
      .update(updatePatch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase.from("hr_approval_logs").insert({
      tenant_id: ctx.actor.tenantId,
      request_id: input.id,
      actor_employee_id: ctx.actor.employeeId,
      actor_role: ctx.actor.role,
      action,
      from_status: currentStatus,
      to_status: toStatus,
      comment: input.comment ?? null,
    });
    if (logErr) throw new Error(logErr.message);

    // Notify next approver (if pending) or requester (if terminal).
    if (toStatus === "APPROVED") {
      const { data: requester } = await supabase
        .from("employees")
        .select("user_id, id")
        .eq("id", current.requester_employee_id)
        .maybeSingle();
      if (requester) {
        await notifyUser({
          recipient: { userId: requester.user_id, employeeId: requester.id },
          kind: "APPROVAL_APPROVED",
          title: `HR request approved · ${current.kind}`,
          actionUrl: `/hr/requests/${input.id}`,
        });
      }
    } else {
      const nextRole = expectedHrApproverRole(toStatus);
      if (nextRole) {
        await notifyRoles({
          tenantId: ctx.actor.tenantId,
          roles: [nextRole, "TENANT_ADMIN"],
          kind: "APPROVAL_REQUESTED",
          title: `HR request awaiting your approval · ${current.kind}`,
          actionUrl: `/hr/requests/${input.id}`,
        });
      }
    }

    revalidatePath("/hr/requests");
    revalidatePath(`/hr/requests/${input.id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: toStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: toStatus, action },
    };
  },
});

// ---------------------------------------------------------------------------
// REJECT
// ---------------------------------------------------------------------------
export const rejectHrRequestAction = withSecureAction({
  schema: rejectHrRequestSchema,
  resource: "hr_request",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "hr_requests",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("hr_requests")
      .select("status, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
      pendingApprovalLevel: row
        ? statusToPdpLevel(row.status as HrRequestStatus)
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("hr_requests")
      .select("id, kind, status, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("HR request not found.");

    const currentStatus = current.status as HrRequestStatus;
    if (!canApproveNextHr(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot reject at status ${currentStatus}.`,
      );
    }

    const { error: updateErr } = await supabase
      .from("hr_requests")
      .update({
        status: "REJECTED",
        rejected_at: new Date().toISOString(),
        rejected_by: ctx.actor.employeeId,
        rejection_reason: input.reason,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase.from("hr_approval_logs").insert({
      tenant_id: ctx.actor.tenantId,
      request_id: input.id,
      actor_employee_id: ctx.actor.employeeId,
      actor_role: ctx.actor.role,
      action: "REJECT",
      from_status: currentStatus,
      to_status: "REJECTED",
      comment: input.reason,
    });
    if (logErr) throw new Error(logErr.message);

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.requester_employee_id)
      .maybeSingle();
    if (requester) {
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "APPROVAL_REJECTED",
        title: `HR request rejected · ${current.kind}`,
        body: input.reason,
        actionUrl: `/hr/requests/${input.id}`,
      });
    }

    revalidatePath("/hr/requests");
    revalidatePath(`/hr/requests/${input.id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: "REJECTED" as HrRequestStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: "REJECTED", reason: input.reason },
    };
  },
});

// ---------------------------------------------------------------------------
// CANCEL
// ---------------------------------------------------------------------------
export const cancelHrRequestAction = withSecureAction({
  schema: cancelHrRequestSchema,
  resource: "hr_request",
  action: "cancel",
  auditAction: "CANCEL",
  auditResourceName: "hr_requests",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("hr_requests")
      .select("status, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("hr_requests")
      .select("id, status, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("HR request not found.");

    if (current.requester_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the requester may cancel this request.");
    }
    if (
      current.status === "APPROVED" ||
      current.status === "REJECTED" ||
      current.status === "CANCELLED"
    ) {
      throw new Error("Cannot cancel a terminal request.");
    }

    const { error: updateErr } = await supabase
      .from("hr_requests")
      .update({ status: "CANCELLED" })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase.from("hr_approval_logs").insert({
      tenant_id: ctx.actor.tenantId,
      request_id: input.id,
      actor_employee_id: ctx.actor.employeeId,
      actor_role: ctx.actor.role,
      action: "CANCEL",
      from_status: current.status as HrRequestStatus,
      to_status: "CANCELLED",
      comment: input.reason ?? null,
    });
    if (logErr) throw new Error(logErr.message);

    revalidatePath("/hr/requests");
    revalidatePath(`/hr/requests/${input.id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: "CANCELLED" as HrRequestStatus },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "CANCELLED" },
    };
  },
});
