"use server";

/**
 * ControlDesk — Server actions for the Chart of Accounts admin surface.
 *
 * Gated by the `coa` PDP resource in `src/lib/security/pdp.ts` and the
 * `chart_of_accounts` RLS policies (migration 0055). No hard-delete
 * action is exposed — soft deactivation preserves history for existing
 * `budget_details.coa_id` references.
 */

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  createCoaSchema,
  toggleCoaActiveSchema,
  updateCoaSchema,
} from "@/lib/validation/coa";

const ADMIN_PAGE = "/settings/coa";
// Budgets use the CoA dropdown on line-item creation — bust their cache
// too so the new / renamed account shows up without a hard reload.
const BUDGETS_PAGE = "/finance/budgets";

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
export const createCoaAction = withSecureAction({
  schema: createCoaSchema,
  resource: "coa",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "chart_of_accounts",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    // Guard: if a parent is specified, it must exist within this tenant.
    if (input.parent_id) {
      const { data: parent } = await supabase
        .from("chart_of_accounts")
        .select("id, is_active")
        .eq("id", input.parent_id)
        .eq("tenant_id", ctx.actor.tenantId)
        .maybeSingle();
      if (!parent) {
        throw new Error("Parent account not found in this tenant.");
      }
      if (!parent.is_active) {
        throw new Error("Parent account is inactive.");
      }
    }

    // Guard: code uniqueness. Rely on the DB unique index for the final
    // word, but return a nicer error first if we can detect a duplicate.
    const { data: existing } = await supabase
      .from("chart_of_accounts")
      .select("id")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("code", input.code)
      .maybeSingle();
    if (existing) {
      throw new Error(`Account code ${input.code} already exists.`);
    }

    const { data, error } = await supabase
      .from("chart_of_accounts")
      .insert({
        tenant_id: ctx.actor.tenantId,
        code: input.code,
        name: input.name,
        account_type: input.account_type,
        normal_side: input.normal_side,
        parent_id: input.parent_id ?? null,
        is_postable: input.is_postable,
        description: input.description ?? null,
        created_by: ctx.actor.employeeId,
        updated_by: ctx.actor.employeeId,
      })
      .select("id, code, name, account_type, normal_side, is_postable, is_active")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create account.");
    }

    revalidatePath(ADMIN_PAGE);
    revalidatePath(BUDGETS_PAGE);

    return {
      result: { id: data.id, code: data.code },
      auditResourceId: data.id,
      auditNewValues: {
        code: data.code,
        name: data.name,
        account_type: data.account_type,
        normal_side: data.normal_side,
        is_postable: data.is_postable,
        is_active: data.is_active,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE — edit everything except tenant_id / id.
// ---------------------------------------------------------------------------
export const updateCoaAction = withSecureAction({
  schema: updateCoaSchema,
  resource: "coa",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "chart_of_accounts",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: prev } = await supabase
      .from("chart_of_accounts")
      .select(
        "id, code, name, account_type, normal_side, parent_id, is_postable, description, is_active",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (!prev) throw new Error("Account not found.");

    // Prevent self-parenting or cycling. A stronger check would walk the
    // ancestry chain — for now a self-reference is by far the common typo
    // and cheap to catch here.
    if (input.parent_id && input.parent_id === input.id) {
      throw new Error("An account cannot be its own parent.");
    }

    // If the code is being changed, check uniqueness in-tenant.
    if (input.code !== prev.code) {
      const { data: dupe } = await supabase
        .from("chart_of_accounts")
        .select("id")
        .eq("tenant_id", ctx.actor.tenantId)
        .eq("code", input.code)
        .neq("id", input.id)
        .maybeSingle();
      if (dupe) {
        throw new Error(`Account code ${input.code} already exists.`);
      }
    }

    // If flipping `is_postable` from true → false, ensure no line item
    // currently references this account. Otherwise budget submits would
    // silently fail server-side validation later.
    if (prev.is_postable && !input.is_postable) {
      const { count } = await supabase
        .from("budget_details")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", ctx.actor.tenantId)
        .eq("coa_id", input.id);
      if ((count ?? 0) > 0) {
        throw new Error(
          "Cannot mark this account as non-postable — budget line items still reference it.",
        );
      }
    }

    const patch = {
      code: input.code,
      name: input.name,
      account_type: input.account_type,
      normal_side: input.normal_side,
      parent_id: input.parent_id ?? null,
      is_postable: input.is_postable,
      description: input.description ?? null,
      updated_by: ctx.actor.employeeId,
    } as const;

    const { error } = await supabase
      .from("chart_of_accounts")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(ADMIN_PAGE);
    revalidatePath(BUDGETS_PAGE);

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: {
        code: prev.code,
        name: prev.name,
        account_type: prev.account_type,
        normal_side: prev.normal_side,
        parent_id: prev.parent_id,
        is_postable: prev.is_postable,
        description: prev.description,
      },
      auditNewValues: patch,
    };
  },
});

// ---------------------------------------------------------------------------
// TOGGLE ACTIVE — soft delete / restore.
// ---------------------------------------------------------------------------
export const toggleCoaActiveAction = withSecureAction({
  schema: toggleCoaActiveSchema,
  resource: "coa",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "chart_of_accounts",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: prev } = await supabase
      .from("chart_of_accounts")
      .select("id, is_active")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (!prev) throw new Error("Account not found.");

    // Deactivating an account is safe (history stays intact) but we still
    // block if any *active* budget draft references it, because such a
    // draft would fail SUBMIT validation later. Approved / applied budgets
    // stay legal — the reference is historical.
    if (prev.is_active && !input.is_active) {
      const { count } = await supabase
        .from("budget_details")
        .select("id, budgets!inner(status)", { count: "exact", head: true })
        .eq("tenant_id", ctx.actor.tenantId)
        .eq("coa_id", input.id)
        .in("budgets.status", ["DRAFT", "PENDING_FINANCE", "PENDING_DIRECTOR"]);
      if ((count ?? 0) > 0) {
        throw new Error(
          "Cannot deactivate — open budgets still reference this account.",
        );
      }
    }

    const { error } = await supabase
      .from("chart_of_accounts")
      .update({ is_active: input.is_active, updated_by: ctx.actor.employeeId })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(ADMIN_PAGE);
    revalidatePath(BUDGETS_PAGE);

    return {
      result: { id: input.id, is_active: input.is_active },
      auditResourceId: input.id,
      auditOldValues: { is_active: prev.is_active },
      auditNewValues: { is_active: input.is_active },
    };
  },
});
