"use server";

/**
 * ControlDesk — Field-Ops Cash Advance server actions (Fase 1.6).
 *
 * Backed by:
 *   - Zod schemas   → `src/lib/validation/field-ops-advance.ts`
 *   - Tables        → `cash_advances` (parent, ca_type='FIELD_OPS')
 *                     `cash_advance_field_ops_details` (1:1, form fields)
 *                     `cash_advance_rab_lines` (N:1, RAB rows)
 *   - PDP           → `cash_advance_field_ops` in `pdp-canonical.ts`
 *   - State machine → `caFieldOpsApprovalChain` in `rbac/roles.ts`
 *                     (thresholds: 5jt PM · 20jt OM · 50jt DIRECTOR)
 *
 * DRAFT lifecycle:
 *   saveDraft   → INSERT parent (DRAFT) + details + rab_lines
 *   updateDraft → UPDATE all three (rab_lines is replace-in-place)
 *   deleteDraft → DELETE parent (cascade → details + rab_lines)
 *   submitDraft → validate submitReady + transition DRAFT →
 *                 PENDING_SUPERVISOR + log + notify L1
 *
 * Approve / reject / cancel / disburse / settlement flows continue to
 * live in `actions-canonical.ts` — the state machine there already
 * handles the FIELD_OPS chain shape via `caFieldOpsApprovalChain`.
 */

import { revalidatePath } from "next/cache";

import {
  submitReadyFieldOpsSchema,
  saveDraftFieldOpsSchema,
  updateDraftFieldOpsSchema,
  submitDraftFieldOpsSchema,
  deleteDraftFieldOpsSchema,
  type RabLineDraft,
} from "@/lib/validation/field-ops-advance";
import { createClient } from "@/lib/supabase/server";
import { assertPostableCoa } from "@/lib/data/coa";
import { assertProjectOperational } from "@/lib/data/projects";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { snapshotCaFieldOpsChain } from "@/lib/rbac/chain-snapshot";
import { resolveThresholds } from "@/lib/rbac/thresholds";
import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import {
  CANONICAL_CA_STATUS_SLOT,
  nextCanonicalCaStatus,
  type CanonicalCaStatus,
} from "@/lib/cash-advance/state-canonical";
import type {
  AnyDbEmployeeRole,
  CaFieldOpsChainThresholds,
  CanonicalApprovalSlot,
} from "@/lib/rbac/roles";
import type {
  CashAdvanceStatus,
  TablesInsert,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Notification helpers. Duplicated (intentionally small) from
// `actions-canonical.ts` so this file stays self-contained.
// ---------------------------------------------------------------------------

const ADMIN_DB_ROLES: readonly AnyDbEmployeeRole[] = [
  "TENANT_ADMIN",
  "ADMIN",
];

function slotToNotifyRoles(
  slot: CanonicalApprovalSlot,
): readonly AnyDbEmployeeRole[] {
  switch (slot) {
    case "SUPERVISOR":
      return ["SUPERVISOR", ...ADMIN_DB_ROLES];
    case "PM":
      return ["PROJECT_MANAGER", "PM", ...ADMIN_DB_ROLES];
    case "OM":
      return ["OPERATIONS_MANAGER", "OM", ...ADMIN_DB_ROLES];
    case "FINANCE":
      return ["LEAD_FINANCE", "FINANCE", ...ADMIN_DB_ROLES];
    case "DIRECTOR":
      return [
        "HEAD_MANAGER",
        "GENERAL_MANAGER",
        "DIRECTOR",
        ...ADMIN_DB_ROLES,
      ];
  }
}

// ---------------------------------------------------------------------------
// Common helpers.
// ---------------------------------------------------------------------------

/**
 * Sanity-check that the actor is currently a FIELD_TECHNICIAN or a
 * higher-rank actor allowed to create field-ops CAs. Returns `false`
 * when a plain EMPLOYEE has no active FIELD_TECHNICIAN assignment.
 */
async function actorMayInitiateFieldOps(input: {
  employeeId: string;
  role: AnyDbEmployeeRole;
}): Promise<boolean> {
  const supervisorPlus: readonly AnyDbEmployeeRole[] = [
    "SUPERVISOR",
    "PROJECT_MANAGER",
    "PM",
    "OPERATIONS_MANAGER",
    "OM",
    "LEAD_FINANCE",
    "FINANCE",
    "HEAD_MANAGER",
    "GENERAL_MANAGER",
    "DIRECTOR",
    "TENANT_ADMIN",
    "ADMIN",
  ];
  if (supervisorPlus.includes(input.role)) return true;

  const supabase = await createClient();
  const { data } = await supabase.rpc("has_active_field_tech_assignment", {
    p_emp_id: input.employeeId,
  });
  return Boolean(data);
}

/**
 * Bulk-insert RAB lines for a parent CA. Runs the sequence and returns
 * the total amount in whole rupiah so the caller can log it.
 */
async function insertRabLines(input: {
  tenantId: string;
  cashAdvanceId: string;
  lines: readonly RabLineDraft[];
}): Promise<number> {
  if (input.lines.length === 0) return 0;

  const supabase = await createClient();
  // Validate every coa_id (if present) before starting the batch insert.
  // We do it sequentially — the list is tiny (≤50 rows) and this keeps
  // the failure message pointing at the offending line index. Rows
  // without a coa_id keep `null` in the column.
  const validatedCoa: (string | null)[] = [];
  for (const line of input.lines) {
    validatedCoa.push(await assertPostableCoa(line.coa_id));
  }
  const rows: TablesInsert<"cash_advance_rab_lines">[] = input.lines.map(
    (line, idx) => ({
      tenant_id: input.tenantId,
      cash_advance_id: input.cashAdvanceId,
      seq: line.seq ?? idx + 1,
      category: line.category,
      detail: line.detail ?? null,
      amount: line.amount as unknown as number,
      coa_id: validatedCoa[idx],
    }),
  );
  const { error } = await supabase.from("cash_advance_rab_lines").insert(rows);
  if (error) throw new Error(error.message);
  return input.lines.reduce((acc, l) => acc + l.amount, 0);
}

/**
 * Replace all RAB lines for a CA (delete existing → insert new). Used
 * by `updateDraftFieldOpsAction`; the DB trigger keeps
 * `cash_advances.amount` in sync automatically.
 */
async function replaceRabLines(input: {
  tenantId: string;
  cashAdvanceId: string;
  lines: readonly RabLineDraft[];
}): Promise<number> {
  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("cash_advance_rab_lines")
    .delete()
    .eq("cash_advance_id", input.cashAdvanceId)
    .eq("tenant_id", input.tenantId);
  if (delErr) throw new Error(delErr.message);
  return insertRabLines(input);
}

// ---------------------------------------------------------------------------
// SAVE DRAFT — insert parent + details + rab_lines (transactionally best-
// effort; if a child fails we rollback the parent so the user can retry).
// ---------------------------------------------------------------------------

export const saveDraftFieldOpsAction = withCanonicalSecureAction({
  schema: saveDraftFieldOpsSchema,
  resource: "cash_advance_field_ops",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const isFieldTech = await actorMayInitiateFieldOps({
      employeeId: ctx.actor.employeeId,
      role: ctx.legacyActor.role,
    });
    return {
      tenantId: ctx.actor.tenantId,
      projectId: input.project_id,
      caType: "FIELD_OPS",
      status: "DRAFT",
      isFieldTech,
      ownerEmployeeId: ctx.actor.employeeId,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    // Fase 1 gate — refuse ops on DRAFT / PLANNING / ARCHIVED projects.
    await assertProjectOperational(input.project_id);

    // 1. Insert parent. `amount` needs a positive placeholder because
    //    the DB has a CHECK (amount > 0); the RAB trigger will overwrite
    //    it as soon as ≥1 rab_line lands. We use `1` as the sentinel and
    //    let the trigger correct it — if there are no rab_lines yet the
    //    parent keeps `1` until the user adds a row, which is acceptable
    //    for a draft.
    const initialAmount =
      input.rab_lines.length > 0
        ? input.rab_lines.reduce((acc, l) => acc + l.amount, 0)
        : 1;
    const { data: parent, error: parentErr } = await supabase
      .from("cash_advances")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        requester_employee_id: ctx.actor.employeeId,
        ca_type: "FIELD_OPS",
        amount: initialAmount as unknown as number,
        purpose:
          input.purpose ??
          `[Draft] Field-Ops — ${input.ticket_number}`,
        needed_by: input.needed_by ?? null,
        status: "DRAFT" satisfies CashAdvanceStatus,
      })
      .select("id, status")
      .single();
    if (parentErr || !parent) {
      throw new Error(parentErr?.message ?? "Failed to save draft.");
    }

    try {
      // 2. Insert 1:1 details row.
      const detailsRow: TablesInsert<"cash_advance_field_ops_details"> = {
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: parent.id,
        ticket_number: input.ticket_number,
        justification: input.justification ?? null,
        unit_pengaju: input.unit_pengaju ?? null,
        cid_company: input.cid_company ?? null,
        area: input.area ?? null,
        tujuan: input.tujuan ?? null,
        pic_name: input.pic_name ?? null,
        pic_phone: input.pic_phone ?? null,
        pickup_key_bts: input.pickup_key_bts ?? false,
        transport_need: input.transport_need ?? null,
        jarak_pp_km: input.jarak_pp_km ?? null,
        gmap_duration: input.gmap_duration ?? null,
        driver_phone: input.driver_phone ?? null,
        bank_owner_name: input.bank_owner_name ?? null,
        bank_name: input.bank_name ?? null,
        bank_account_no: input.bank_account_no ?? null,
        created_by: ctx.actor.employeeId,
        updated_by: ctx.actor.employeeId,
      };
      const { error: detailsErr } = await supabase
        .from("cash_advance_field_ops_details")
        .insert(detailsRow);
      if (detailsErr) throw new Error(detailsErr.message);

      // 3. Insert RAB lines (trigger keeps parent.amount in sync).
      await insertRabLines({
        tenantId: ctx.actor.tenantId,
        cashAdvanceId: parent.id,
        lines: input.rab_lines,
      });
    } catch (err) {
      // Best-effort cleanup: children may have partially landed; the
      // parent's ON DELETE CASCADE will wipe them.
      await supabase
        .from("cash_advances")
        .delete()
        .eq("id", parent.id)
        .eq("tenant_id", ctx.actor.tenantId);
      throw err instanceof Error ? err : new Error("Failed to save draft.");
    }

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${parent.id}`);

    return {
      result: {
        id: parent.id,
        status: parent.status as CashAdvanceStatus,
      },
      auditResourceId: parent.id,
      auditNewValues: {
        ca_type: "FIELD_OPS",
        project_id: input.project_id,
        ticket_number: input.ticket_number,
        status: parent.status,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE DRAFT — modify parent + details + replace rab_lines. Owner-only
// (PDP enforces via `ownerEmployeeId` gate for `update` action).
// ---------------------------------------------------------------------------

export const updateDraftFieldOpsAction = withCanonicalSecureAction({
  schema: updateDraftFieldOpsSchema,
  resource: "cash_advance_field_ops",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current } = await supabase
      .from("cash_advances")
      .select("status, requester_employee_id, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: current?.project_id ?? input.project_id,
      caType: "FIELD_OPS",
      status: current?.status ?? "DRAFT",
      ownerEmployeeId: current?.requester_employee_id ?? ctx.actor.employeeId,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    // Confirm the row is still editable (DRAFT / PENDING_SUPERVISOR).
    const { data: current, error: readErr } = await supabase
      .from("cash_advances")
      .select("id, status, project_id, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Draft not found.");
    if (
      current.status !== "DRAFT" &&
      current.status !== "PENDING_SUPERVISOR"
    ) {
      throw new Error(`Draft locked at status ${current.status}.`);
    }

    // 1. Update parent metadata.
    const { error: parentErr } = await supabase
      .from("cash_advances")
      .update({
        project_id: input.project_id,
        purpose:
          input.purpose ??
          `[Draft] Field-Ops — ${input.ticket_number}`,
        needed_by: input.needed_by ?? null,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (parentErr) throw new Error(parentErr.message);

    // 2. Upsert 1:1 details row. Cascade-on-parent-delete + UNIQUE FK on
    //    cash_advance_id means we can rely on `onConflict` here.
    const { error: detailsErr } = await supabase
      .from("cash_advance_field_ops_details")
      .upsert(
        {
          tenant_id: ctx.actor.tenantId,
          cash_advance_id: input.id,
          ticket_number: input.ticket_number,
          justification: input.justification ?? null,
          unit_pengaju: input.unit_pengaju ?? null,
          cid_company: input.cid_company ?? null,
          area: input.area ?? null,
          tujuan: input.tujuan ?? null,
          pic_name: input.pic_name ?? null,
          pic_phone: input.pic_phone ?? null,
          pickup_key_bts: input.pickup_key_bts ?? false,
          transport_need: input.transport_need ?? null,
          jarak_pp_km: input.jarak_pp_km ?? null,
          gmap_duration: input.gmap_duration ?? null,
          driver_phone: input.driver_phone ?? null,
          bank_owner_name: input.bank_owner_name ?? null,
          bank_name: input.bank_name ?? null,
          bank_account_no: input.bank_account_no ?? null,
          updated_by: ctx.actor.employeeId,
        },
        { onConflict: "cash_advance_id" },
      );
    if (detailsErr) throw new Error(detailsErr.message);

    // 3. Replace RAB lines.
    await replaceRabLines({
      tenantId: ctx.actor.tenantId,
      cashAdvanceId: input.id,
      lines: input.rab_lines,
    });

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${input.id}`);

    return {
      result: { id: input.id, status: current.status as CashAdvanceStatus },
      auditResourceId: input.id,
      auditNewValues: {
        ca_type: "FIELD_OPS",
        project_id: input.project_id,
        ticket_number: input.ticket_number,
        rab_line_count: input.rab_lines.length,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// DELETE DRAFT — owner-only. Cascade wipes children.
// ---------------------------------------------------------------------------

export const deleteDraftFieldOpsAction = withCanonicalSecureAction({
  schema: deleteDraftFieldOpsSchema,
  resource: "cash_advance_field_ops",
  action: "cancel",
  auditAction: "DELETE",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current } = await supabase
      .from("cash_advances")
      .select("status, requester_employee_id, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: current?.project_id ?? undefined,
      caType: "FIELD_OPS",
      status: current?.status ?? "DRAFT",
      ownerEmployeeId: current?.requester_employee_id ?? ctx.actor.employeeId,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("cash_advances")
      .select("id, status, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Draft not found.");
    if (current.status !== "DRAFT") {
      throw new Error("Only DRAFT rows can be deleted here.");
    }

    const { error: deleteErr } = await supabase
      .from("cash_advances")
      .delete()
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (deleteErr) throw new Error(deleteErr.message);

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${input.id}`);

    return {
      result: { id: input.id, status: "CANCELLED" as CashAdvanceStatus },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { deleted: true },
    };
  },
});

// ---------------------------------------------------------------------------
// SUBMIT DRAFT — DRAFT → PENDING_SUPERVISOR + log + notify L1 approver.
// The L1 approver is resolved via the DB helper `resolve_field_ops_l2_approver`
// (which prefers SITE_SUPERVISOR assignment, falling back to PM). If none
// exists we still fan out to the tenant-wide SUPERVISOR role via `notifyRoles`
// so a human can pick it up.
// ---------------------------------------------------------------------------

export const submitDraftFieldOpsAction = withCanonicalSecureAction({
  schema: submitDraftFieldOpsSchema,
  resource: "cash_advance_field_ops",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current } = await supabase
      .from("cash_advances")
      .select("project_id, requester_employee_id, status, amount")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();

    const isFieldTech = await actorMayInitiateFieldOps({
      employeeId: ctx.actor.employeeId,
      role: ctx.legacyActor.role,
    });

    return {
      tenantId: ctx.actor.tenantId,
      projectId: current?.project_id ?? undefined,
      caType: "FIELD_OPS",
      status: current?.status ?? "DRAFT",
      ownerEmployeeId: current?.requester_employee_id ?? ctx.actor.employeeId,
      amountIDR: current
        ? Math.round(Number(current.amount as unknown as number))
        : undefined,
      isFieldTech,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    // 1. Load the row + all children so we can run the submit-ready gate.
    const { data: parent, error: parentErr } = await supabase
      .from("cash_advances")
      .select(
        "id, status, project_id, amount, requester_employee_id, ca_type",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (parentErr || !parent) throw new Error("Draft not found.");
    // Fase 1 gate — refuse submit if the project was moved back to
    // DRAFT/PLANNING while the CA was drafted.
    await assertProjectOperational(parent.project_id);
    if (parent.status !== "DRAFT") {
      throw new Error(`Draft already submitted (status=${parent.status}).`);
    }
    if (parent.ca_type !== "FIELD_OPS") {
      throw new Error("Not a field-ops cash advance.");
    }
    if (parent.requester_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the requester may submit their own draft.");
    }

    const { data: details, error: detailsErr } = await supabase
      .from("cash_advance_field_ops_details")
      .select("*")
      .eq("cash_advance_id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (detailsErr || !details) {
      throw new Error("Field-ops details row missing.");
    }

    const { data: rabRows, error: rabErr } = await supabase
      .from("cash_advance_rab_lines")
      .select("id, seq, category, detail, amount")
      .eq("cash_advance_id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .order("seq", { ascending: true });
    if (rabErr) throw new Error(rabErr.message);

    // 2. Validate submit-ready shape.
    const readyCheck = submitReadyFieldOpsSchema.safeParse({
      project_id: parent.project_id,
      ticket_number: details.ticket_number,
      unit_pengaju: details.unit_pengaju ?? "",
      area: details.area ?? "",
      tujuan: details.tujuan ?? "",
      transport_need: details.transport_need ?? "",
      bank_owner_name: details.bank_owner_name ?? "",
      bank_name: details.bank_name ?? "",
      bank_account_no: details.bank_account_no ?? "",
      rab_lines: (rabRows ?? []).map((row) => ({
        id: row.id,
        seq: row.seq,
        category: row.category,
        detail: row.detail ?? undefined,
        amount: Number(row.amount as unknown as number),
      })),
    });
    if (!readyCheck.success) {
      const issue = readyCheck.error.issues[0];
      throw new Error(
        issue?.message ?? "Form is missing required fields for submit.",
      );
    }

    // 3. Compute next status via canonical state machine. amount is
    //    already sync'd by the RAB trigger; we normalise via Number().
    const amountIDR = Math.round(Number(parent.amount as unknown as number));
    const t = await resolveThresholds(
      ctx.actor.tenantId,
      "CASH_ADVANCE_FIELD_OPS",
    );
    if (t.kind !== "CASH_ADVANCE_FIELD_OPS") {
      throw new Error(
        `Unexpected threshold kind ${t.kind} for CASH_ADVANCE_FIELD_OPS.`,
      );
    }
    const foThresholds: CaFieldOpsChainThresholds = t;
    const nextStatus = nextCanonicalCaStatus({
      type: "FIELD_OPS",
      amountIDR,
      current: "DRAFT",
      action: "SUBMIT",
      thresholds: foThresholds,
    });
    // Freeze the chain at submit (rules §9 / §22).
    const chainSnapshot = snapshotCaFieldOpsChain({
      amountIDR,
      thresholds: foThresholds,
    });

    // 4. Transition + submit log.
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("cash_advances")
      .update({
        status: nextStatus satisfies CashAdvanceStatus,
        chain_snapshot: chainSnapshot,
        // `submitted_at` isn't a first-class column on cash_advances;
        // we log the transition instead. Keeping this comment as an
        // anchor if a future migration adds the column.
      })
      .eq("id", parent.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("cash_advance_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: parent.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.legacyActor.role,
        action: "SUBMIT",
        from_status: "DRAFT",
        to_status: nextStatus satisfies CashAdvanceStatus,
        comment: null,
      });
    if (logErr) throw new Error(logErr.message);

    // 5. Notify L1 — resolve preferred approver via the DB helper.
    const { data: preferredL1 } = await supabase.rpc(
      "resolve_field_ops_l2_approver",
      { p_project_id: parent.project_id },
    );
    const nextSlot = CANONICAL_CA_STATUS_SLOT[nextStatus as CanonicalCaStatus];
    if (nextSlot) {
      // Personal notification to the resolved approver (best effort).
      if (preferredL1 && typeof preferredL1 === "string") {
        const { data: recipient } = await supabase
          .from("employees")
          .select("user_id, id")
          .eq("id", preferredL1)
          .maybeSingle();
        if (recipient) {
          await notifyUser({
            recipient: {
              userId: recipient.user_id,
              employeeId: recipient.id,
            },
            kind: "APPROVAL_REQUESTED",
            title: `Pengajuan Dana Operasional · ${details.ticket_number}`,
            body: `Rp ${amountIDR.toLocaleString("id-ID")} — ${details.area ?? ""}`,
            actionUrl: `/finance/cash-advances/${parent.id}`,
            payload: {
              cash_advance_id: parent.id,
              ca_type: "FIELD_OPS",
              ticket_number: details.ticket_number,
            },
          });
        }
      }
      // Fan-out to the slot role as a safety net.
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: slotToNotifyRoles(nextSlot),
        kind: "APPROVAL_REQUESTED",
        title: `Pengajuan Dana Operasional · ${details.ticket_number}`,
        body: `Rp ${amountIDR.toLocaleString("id-ID")} — ${details.area ?? ""}`,
        actionUrl: `/finance/cash-advances/${parent.id}`,
        payload: {
          cash_advance_id: parent.id,
          ca_type: "FIELD_OPS",
          ticket_number: details.ticket_number,
        },
      });
    }

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${parent.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${parent.project_id}`);

    return {
      result: {
        id: parent.id,
        status: nextStatus as CashAdvanceStatus,
      },
      auditResourceId: parent.id,
      auditOldValues: { status: "DRAFT" },
      auditNewValues: {
        status: nextStatus,
        amount: amountIDR,
        submitted_at: nowIso,
      },
    };
  },
});
