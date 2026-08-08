"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { translatorFor } from "@/lib/notifications/localize";
import {
  computeMonthlySnapshot,
  defaultSectionDrafts,
} from "@/lib/data/monthly-reports";
import {
  cancelMonthlyReportSchema,
  createMonthlyReportSchema,
  decideMonthlyReportByPmSchema,
  generateBeritaAcaraSchema,
  periodMonthToDbDate,
  recordClientDecisionSchema,
  sendMonthlyReportToClientSchema,
  submitMonthlyReportSchema,
  upsertMonthlyReportSectionSchema,
  type MonthlyReportStatus,
} from "@/lib/validation/monthly-report";

/**
 * Monthly report workflow (rules §26).
 *   SPV drafts → SUBMITTED_TO_PM → PM approves (APPROVED_BY_PM)
 *                                → PM returns  (RETURNED_TO_SPV)
 *                                → PM rejects  (REJECTED_BY_PM terminal)
 *   Later slices extend the state machine towards client sign-off +
 *   Berita Acara + collection handoff.
 */

// ---------------------------------------------------------------------
// CREATE — one row per (project, period_month). Pre-seeds sections
// from a monthly snapshot so the SPV form opens populated.
// ---------------------------------------------------------------------
export const createMonthlyReportAction = withSecureAction({
  schema: createMonthlyReportSchema,
  resource: "monthly_report",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "monthly_reports",
  resolveAttributes: (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    projectId: input.project_id,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const periodIso = periodMonthToDbDate(input.period_month);

    // Resolve the active PM for the project — it's the default
    // reviewer. If none exists we leave the field null and the PM
    // reviews via role fanout at submit time.
    const { data: pma } = await supabase
      .from("project_pm_assignments")
      .select("pm_employee_id")
      .eq("project_id", input.project_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("status", "ACTIVE")
      .eq("assignment_role", "PRIMARY_PM")
      .maybeSingle();

    // Refuse duplicate active reports for the same (project, month).
    // Cancelled rows are excluded — SPV may retry.
    const { data: existing } = await supabase
      .from("monthly_reports")
      .select("id, status")
      .eq("project_id", input.project_id)
      .eq("period_month", periodIso)
      .eq("tenant_id", ctx.actor.tenantId)
      .neq("status", "CANCELLED")
      .maybeSingle();
    if (existing) {
      throw new Error(
        `A monthly report already exists for this project + month (id ${existing.id}).`,
      );
    }

    const { data: inserted, error } = await supabase
      .from("monthly_reports")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        period_month: periodIso,
        submitter_employee_id: ctx.actor.employeeId,
        pm_reviewer_id: pma?.pm_employee_id ?? null,
        status: "DRAFT_BY_SPV" as MonthlyReportStatus,
        created_by: ctx.actor.employeeId,
        updated_by: ctx.actor.employeeId,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to create monthly report.");
    }

    // Pre-seed sections from a computed snapshot. Best-effort — a
    // snapshot failure should not block the SPV from continuing.
    try {
      const snap = await computeMonthlySnapshot({
        projectId: input.project_id,
        periodMonth: input.period_month,
      });
      const rows = defaultSectionDrafts(snap).map((s) => ({
        tenant_id: ctx.actor.tenantId,
        report_id: inserted.id,
        kind: s.kind,
        content: s.content,
        metrics: s.metrics as never,
      }));
      await supabase.from("monthly_report_sections").insert(rows);
    } catch {
      // swallow — user can fill sections manually.
    }

    revalidatePath(`/projects/${input.project_id}`);
    revalidatePath(`/projects/${input.project_id}/monthly-reports`);
    return {
      result: { id: inserted.id },
      auditResourceId: inserted.id,
      auditNewValues: {
        project_id: input.project_id,
        period_month: periodIso,
      },
    };
  },
});

// ---------------------------------------------------------------------
// UPSERT SECTION — SPV / PM edit narrative + metrics.
// ---------------------------------------------------------------------
export const upsertMonthlyReportSectionAction = withSecureAction({
  schema: upsertMonthlyReportSectionSchema,
  resource: "monthly_report",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "monthly_report_sections",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: parent, error: pErr } = await supabase
      .from("monthly_reports")
      .select("id, status, submitter_employee_id, project_id")
      .eq("id", input.report_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (pErr || !parent) throw new Error("Report not found.");

    // Locked states — SPV can only edit DRAFT / RETURNED. PM can edit
    // metrics in SUBMITTED (rare, for corrections) — kept permissive
    // for now and audited.
    if (
      parent.status !== "DRAFT_BY_SPV" &&
      parent.status !== "RETURNED_TO_SPV" &&
      parent.status !== "SUBMITTED_TO_PM"
    ) {
      throw new Error(`Sections are locked at status ${parent.status}.`);
    }

    const { error } = await supabase.from("monthly_report_sections").upsert(
      {
        tenant_id: ctx.actor.tenantId,
        report_id: input.report_id,
        kind: input.kind,
        content: input.content ?? null,
        metrics: (input.metrics ?? {}) as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "report_id,kind" },
    );
    if (error) throw new Error(error.message);

    revalidatePath(
      `/projects/${parent.project_id}/monthly-reports/${input.report_id}`,
    );
    return {
      result: { report_id: input.report_id, kind: input.kind },
      auditResourceId: input.report_id,
      auditNewValues: { kind: input.kind },
    };
  },
});

// ---------------------------------------------------------------------
// SUBMIT — SPV → PM.
// ---------------------------------------------------------------------
export const submitMonthlyReportAction = withSecureAction({
  schema: submitMonthlyReportSchema,
  resource: "monthly_report",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "monthly_reports",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("monthly_reports")
      .select(
        "id, status, submitter_employee_id, pm_reviewer_id, project_id, period_month",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Report not found.");
    if (
      parent.status !== "DRAFT_BY_SPV" &&
      parent.status !== "RETURNED_TO_SPV"
    ) {
      throw new Error(`Cannot submit from ${parent.status}.`);
    }

    // Require at least an executive summary before submit — this is
    // the section that always matters even when metrics are empty.
    const { data: exec } = await supabase
      .from("monthly_report_sections")
      .select("content")
      .eq("report_id", parent.id)
      .eq("kind", "EXECUTIVE_SUMMARY")
      .maybeSingle();
    if (!exec?.content || exec.content.trim().length === 0) {
      throw new Error("Please fill the executive summary before submitting.");
    }

    const nowIso = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("monthly_reports")
      .update({
        status: "SUBMITTED_TO_PM",
        spv_notes: input.spv_notes ?? null,
        submitted_at: nowIso,
        updated_by: ctx.actor.employeeId,
      })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Notify PM (assigned or broadcast).
    if (parent.pm_reviewer_id) {
      const { data: pmUser } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", parent.pm_reviewer_id)
        .maybeSingle();
      if (pmUser?.user_id) {
        const { t } = await translatorFor({
          employeeId: parent.pm_reviewer_id,
          namespace: "notifications.monthlyReports",
        });
        await notifyUser({
          recipient: {
            userId: pmUser.user_id,
            employeeId: parent.pm_reviewer_id,
          },
          kind: "MONTHLY_REPORT_SUBMITTED",
          title: t("submittedTitle"),
          body: t("submittedBody"),
          actionUrl: `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
          payload: {
            monthly_report_id: parent.id,
            project_id: parent.project_id,
          },
        });
      }
    } else {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["PROJECT_MANAGER"],
        kind: "MONTHLY_REPORT_SUBMITTED",
        title: "New monthly report awaiting your review",
        actionUrl: `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
        payload: {
          monthly_report_id: parent.id,
          project_id: parent.project_id,
        },
      });
    }

    revalidatePath(`/projects/${parent.project_id}/monthly-reports`);
    revalidatePath(
      `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
    );
    return {
      result: { id: parent.id, status: "SUBMITTED_TO_PM" as const },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: { status: "SUBMITTED_TO_PM" },
    };
  },
});

// ---------------------------------------------------------------------
// PM DECISION — APPROVE / RETURN / REJECT.
// ---------------------------------------------------------------------
export const decideMonthlyReportByPmAction = withSecureAction({
  schema: decideMonthlyReportByPmSchema,
  resource: "monthly_report",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "monthly_reports",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("monthly_reports")
      .select(
        "id, status, submitter_employee_id, pm_reviewer_id, project_id",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Report not found.");
    if (parent.status !== "SUBMITTED_TO_PM") {
      throw new Error(
        `PM decision valid only from SUBMITTED_TO_PM (current: ${parent.status}).`,
      );
    }

    const nextStatus: MonthlyReportStatus =
      input.decision === "APPROVE"
        ? "APPROVED_BY_PM"
        : input.decision === "RETURN"
          ? "RETURNED_TO_SPV"
          : "REJECTED_BY_PM";
    const nowIso = new Date().toISOString();

    const { error: uErr } = await supabase
      .from("monthly_reports")
      .update({
        status: nextStatus,
        pm_notes: input.pm_notes ?? null,
        pm_decided_at: nowIso,
        pm_reviewer_id: parent.pm_reviewer_id ?? ctx.actor.employeeId,
        updated_by: ctx.actor.employeeId,
      })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Notify SPV of the outcome.
    if (parent.submitter_employee_id) {
      const { data: spvUser } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", parent.submitter_employee_id)
        .maybeSingle();
      if (spvUser?.user_id) {
        const { t } = await translatorFor({
          employeeId: parent.submitter_employee_id,
          namespace: "notifications.monthlyReports",
        });
        const kind =
          input.decision === "APPROVE"
            ? ("MONTHLY_REPORT_APPROVED" as const)
            : input.decision === "RETURN"
              ? ("MONTHLY_REPORT_RETURNED" as const)
              : ("MONTHLY_REPORT_REJECTED" as const);
        await notifyUser({
          recipient: {
            userId: spvUser.user_id,
            employeeId: parent.submitter_employee_id,
          },
          kind,
          title:
            input.decision === "APPROVE"
              ? t("approvedTitle")
              : input.decision === "RETURN"
                ? t("returnedTitle")
                : t("rejectedTitle"),
          body: input.pm_notes ?? undefined,
          actionUrl: `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
          payload: {
            monthly_report_id: parent.id,
            project_id: parent.project_id,
          },
        });
      }
    }

    revalidatePath(`/projects/${parent.project_id}/monthly-reports`);
    revalidatePath(
      `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
    );
    return {
      result: { id: parent.id, status: nextStatus },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: { status: nextStatus, decision: input.decision },
    };
  },
});

// ---------------------------------------------------------------------
// CANCEL — management can cancel any monthly report (except after
// collection handoff — future slice).
// ---------------------------------------------------------------------
export const cancelMonthlyReportAction = withSecureAction({
  schema: cancelMonthlyReportSchema,
  resource: "monthly_report",
  action: "cancel",
  auditAction: "UPDATE",
  auditResourceName: "monthly_reports",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("monthly_reports")
      .select("id, status, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Report not found.");
    if (
      parent.status === "HANDED_OFF_TO_COLLECTION" ||
      parent.status === "CANCELLED"
    ) {
      throw new Error(`Cannot cancel at status ${parent.status}.`);
    }

    const { error: uErr } = await supabase
      .from("monthly_reports")
      .update({ status: "CANCELLED", updated_by: ctx.actor.employeeId })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    revalidatePath(`/projects/${parent.project_id}/monthly-reports`);
    return {
      result: { id: parent.id, status: "CANCELLED" as const },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: { status: "CANCELLED" },
    };
  },
});

// ---------------------------------------------------------------------
// Slice B — Client sign-off + Berita Acara.
// PM-mediated flow. No client portal integration in this slice — PM
// dispatches out-of-band and records the client's decision manually.
// ---------------------------------------------------------------------

/**
 * PM dispatches the approved report to the client. Only valid from
 * `APPROVED_BY_PM`. Notifies the project admin / finance so they know
 * to expect the client's response.
 */
export const sendMonthlyReportToClientAction = withSecureAction({
  schema: sendMonthlyReportToClientSchema,
  resource: "monthly_report",
  action: "approve",
  // The audit enum doesn't have a dedicated SEND value — SUBMIT is
  // the closest semantic (PM submits the report to the client) and
  // the resource name + newValues capture the specific transition.
  auditAction: "SUBMIT",
  auditResourceName: "monthly_reports",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("monthly_reports")
      .select(
        "id, status, project_id, submitter_employee_id, pm_reviewer_id",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Report not found.");
    if (parent.status !== "APPROVED_BY_PM") {
      throw new Error(
        `Report must be APPROVED_BY_PM before sending to client (current: ${parent.status}).`,
      );
    }

    const nowIso = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("monthly_reports")
      .update({
        status: "SENT_TO_CLIENT",
        sent_to_client_at: nowIso,
        sent_to_client_by: ctx.actor.employeeId,
        client_reviewer_email:
          input.client_email ?? undefined /* keep existing on undefined */,
        updated_by: ctx.actor.employeeId,
      })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Notify SPV — they usually care that it's now in the client's
    // hands so they can plan follow-up.
    if (parent.submitter_employee_id) {
      const { data: spvUser } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", parent.submitter_employee_id)
        .maybeSingle();
      if (spvUser?.user_id) {
        const { t } = await translatorFor({
          employeeId: parent.submitter_employee_id,
          namespace: "notifications.monthlyReports",
        });
        await notifyUser({
          recipient: {
            userId: spvUser.user_id,
            employeeId: parent.submitter_employee_id,
          },
          kind: "MONTHLY_REPORT_SENT_TO_CLIENT",
          title: t("sentTitle"),
          body: input.send_notes ?? undefined,
          actionUrl: `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
          payload: {
            monthly_report_id: parent.id,
            project_id: parent.project_id,
          },
        });
      }
    }

    revalidatePath(`/projects/${parent.project_id}/monthly-reports`);
    revalidatePath(
      `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
    );
    return {
      result: { id: parent.id, status: "SENT_TO_CLIENT" as const },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: {
        status: "SENT_TO_CLIENT",
        client_email: input.client_email ?? null,
      },
    };
  },
});

/**
 * PM records the client's decision. On APPROVE → `APPROVED_BY_CLIENT`.
 * On REJECT → back to `APPROVED_BY_PM` so PM can revise / resend
 * (loop-back) without reopening the SPV draft. Notes required on
 * reject (enforced at schema level).
 */
export const recordClientDecisionAction = withSecureAction({
  schema: recordClientDecisionSchema,
  resource: "monthly_report",
  action: "approve",
  // Mapping to APPROVE / REJECT is done via `auditNewValues.decision`
  // — the audit enum stays coarse-grained on purpose.
  auditAction: "APPROVE",
  auditResourceName: "monthly_reports",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("monthly_reports")
      .select(
        "id, status, project_id, submitter_employee_id, pm_reviewer_id",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Report not found.");
    if (parent.status !== "SENT_TO_CLIENT") {
      throw new Error(
        `Client decision valid only from SENT_TO_CLIENT (current: ${parent.status}).`,
      );
    }

    // Guard the storage path — must be scoped to this tenant + report.
    // We refuse any path that doesn't start with
    // `{tenant_id}/monthly_report/{report_id}/` so a caller can't
    // accidentally attach an unrelated file. Uses the singular
    // `monthly_report` because that's the `AttachmentResourceType`
    // value used by `buildStoragePath` in `lib/attachments`.
    if (input.signature_path) {
      const expectedPrefix = `${ctx.actor.tenantId}/monthly_report/${parent.id}/`;
      if (!input.signature_path.startsWith(expectedPrefix)) {
        throw new Error(
          "Signature path is outside this report's storage folder.",
        );
      }
    }

    const nextStatus: MonthlyReportStatus =
      input.decision === "APPROVE" ? "APPROVED_BY_CLIENT" : "APPROVED_BY_PM";
    const decidedAtIso = input.decided_at
      ? `${input.decided_at}T00:00:00.000Z`
      : new Date().toISOString();

    const { error: uErr } = await supabase
      .from("monthly_reports")
      .update({
        status: nextStatus,
        client_reviewer_name: input.reviewer_name,
        client_reviewer_email:
          input.reviewer_email ?? undefined /* keep existing when omitted */,
        client_decided_at: decidedAtIso,
        client_decision_notes: input.notes ?? null,
        client_signature_path: input.signature_path ?? null,
        client_signature_file_name: input.signature_file_name ?? null,
        updated_by: ctx.actor.employeeId,
      })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Notify SPV + Finance (on approve, finance cares because billing
    // becomes unblocked).
    if (parent.submitter_employee_id) {
      const { data: spvUser } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", parent.submitter_employee_id)
        .maybeSingle();
      if (spvUser?.user_id) {
        const { t } = await translatorFor({
          employeeId: parent.submitter_employee_id,
          namespace: "notifications.monthlyReports",
        });
        await notifyUser({
          recipient: {
            userId: spvUser.user_id,
            employeeId: parent.submitter_employee_id,
          },
          kind:
            input.decision === "APPROVE"
              ? "MONTHLY_REPORT_APPROVED_BY_CLIENT"
              : "MONTHLY_REPORT_REJECTED_BY_CLIENT",
          title:
            input.decision === "APPROVE"
              ? t("clientApprovedTitle")
              : t("clientRejectedTitle"),
          body: input.notes ?? undefined,
          actionUrl: `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
          payload: {
            monthly_report_id: parent.id,
            project_id: parent.project_id,
          },
        });
      }
    }
    if (input.decision === "APPROVE") {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["LEAD_FINANCE"],
        kind: "MONTHLY_REPORT_APPROVED_BY_CLIENT",
        title: "Client-approved monthly report — ready for BA",
        actionUrl: `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
        payload: {
          monthly_report_id: parent.id,
          project_id: parent.project_id,
        },
      });
    }

    revalidatePath(`/projects/${parent.project_id}/monthly-reports`);
    revalidatePath(
      `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
    );
    return {
      result: { id: parent.id, status: nextStatus },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: {
        status: nextStatus,
        client_reviewer_name: input.reviewer_name,
        decision: input.decision,
      },
    };
  },
});

/**
 * Generate the Berita Acara after client approval. Only valid from
 * `APPROVED_BY_CLIENT`. Server-generates the BA number via
 * `public.next_ba_number()` — never trusts a client-supplied value.
 * Period defaults to the report's `period_month` when not supplied.
 */
export const generateBeritaAcaraAction = withSecureAction({
  schema: generateBeritaAcaraSchema,
  resource: "monthly_report",
  action: "approve",
  // A Berita Acara is a new artefact — audit as CREATE so downstream
  // filters (`resource_name = monthly_reports AND action_type = CREATE`)
  // list the exact moment each BA number was issued.
  auditAction: "CREATE",
  auditResourceName: "monthly_reports",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: parent, error } = await supabase
      .from("monthly_reports")
      .select(
        "id, status, project_id, period_month, submitter_employee_id, pm_reviewer_id",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (error || !parent) throw new Error("Report not found.");
    if (parent.status !== "APPROVED_BY_CLIENT") {
      throw new Error(
        `BA generation valid only from APPROVED_BY_CLIENT (current: ${parent.status}).`,
      );
    }

    // Default the BA period to the calendar month of the report.
    const periodMonthDate = new Date(parent.period_month);
    const yyyy = periodMonthDate.getUTCFullYear();
    const mm = periodMonthDate.getUTCMonth();
    const firstOfMonth = new Date(Date.UTC(yyyy, mm, 1))
      .toISOString()
      .slice(0, 10);
    const lastOfMonth = new Date(Date.UTC(yyyy, mm + 1, 0))
      .toISOString()
      .slice(0, 10);

    // Ask Postgres to atomically issue the next BA number for the
    // tenant + current year. The RPC returns the formatted string.
    const { data: baNum, error: baErr } = await supabase.rpc(
      "next_ba_number",
      { v_tenant_id: ctx.actor.tenantId, v_year: yyyy },
    );
    if (baErr || !baNum) {
      throw new Error(
        `Failed to generate BA number: ${baErr?.message ?? "empty"}`,
      );
    }

    const nowIso = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("monthly_reports")
      .update({
        status: "BA_GENERATED",
        ba_number: baNum as string,
        ba_period_start: input.period_start ?? firstOfMonth,
        ba_period_end: input.period_end ?? lastOfMonth,
        ba_notes: input.ba_notes ?? null,
        ba_generated_at: nowIso,
        ba_generated_by: ctx.actor.employeeId,
        updated_by: ctx.actor.employeeId,
      })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (uErr) throw new Error(uErr.message);

    // Notify SPV + Finance (collection team).
    if (parent.submitter_employee_id) {
      const { data: spvUser } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", parent.submitter_employee_id)
        .maybeSingle();
      if (spvUser?.user_id) {
        const { t } = await translatorFor({
          employeeId: parent.submitter_employee_id,
          namespace: "notifications.monthlyReports",
        });
        await notifyUser({
          recipient: {
            userId: spvUser.user_id,
            employeeId: parent.submitter_employee_id,
          },
          kind: "MONTHLY_REPORT_BA_GENERATED",
          title: t("baGeneratedTitle"),
          body: `${baNum as string}`,
          actionUrl: `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
          payload: {
            monthly_report_id: parent.id,
            project_id: parent.project_id,
            ba_number: baNum as string,
          },
        });
      }
    }
    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["LEAD_FINANCE"],
      kind: "MONTHLY_REPORT_BA_GENERATED",
      title: `BA generated — ${baNum as string}`,
      body: "Ready for collection handoff.",
      actionUrl: `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
      payload: {
        monthly_report_id: parent.id,
        project_id: parent.project_id,
        ba_number: baNum as string,
      },
    });

    revalidatePath(`/projects/${parent.project_id}/monthly-reports`);
    revalidatePath(
      `/projects/${parent.project_id}/monthly-reports/${parent.id}`,
    );
    return {
      result: { id: parent.id, ba_number: baNum as string },
      auditResourceId: parent.id,
      auditOldValues: { status: parent.status },
      auditNewValues: {
        status: "BA_GENERATED",
        ba_number: baNum as string,
      },
    };
  },
});
