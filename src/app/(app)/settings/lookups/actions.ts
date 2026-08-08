"use server";

/**
 * ControlDesk — Server actions for the admin lookup CRUD surface.
 *
 * All mutations go through `withSecureAction` gated by the
 * `lookup_option` PDP resource in `src/lib/security/pdp.ts`. RLS
 * enforces the same admin-only write at the DB layer.
 */

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  createLookupOptionSchema,
  deleteLookupOptionSchema,
  toggleLookupOptionActiveSchema,
  updateLookupOptionSchema,
} from "@/lib/validation/lookup";

const ADMIN_PAGE = "/settings/lookups";

// ---------------------------------------------------------------------------
// CREATE — insert a new option in a domain.
// ---------------------------------------------------------------------------

export const createLookupOptionAction = withSecureAction({
  schema: createLookupOptionSchema,
  resource: "lookup_option",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "lookup_options",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("lookup_options")
      .insert({
        tenant_id: ctx.actor.tenantId,
        domain: input.domain,
        code: input.code,
        label: input.label,
        description: input.description ?? null,
        sort_order: input.sort_order ?? 100,
        is_active: input.is_active ?? true,
        created_by: ctx.actor.employeeId,
        updated_by: ctx.actor.employeeId,
      })
      .select("id, domain, code, label, is_active")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create lookup option.");
    }

    revalidatePath(ADMIN_PAGE);
    revalidatePath("/finance/cash-advances");

    return {
      result: {
        id: data.id,
        domain: data.domain,
        code: data.code,
        label: data.label,
        is_active: data.is_active,
      },
      auditResourceId: data.id,
      auditNewValues: {
        domain: data.domain,
        code: data.code,
        label: data.label,
        is_active: data.is_active,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE — edit an existing option. Domain is immutable.
// ---------------------------------------------------------------------------

export const updateLookupOptionAction = withSecureAction({
  schema: updateLookupOptionSchema,
  resource: "lookup_option",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "lookup_options",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: prev } = await supabase
      .from("lookup_options")
      .select("id, domain, code, label, description, sort_order, is_active")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (!prev) throw new Error("Lookup option not found.");

    const patch: {
      code: string;
      label: string;
      description: string | null;
      updated_by: string;
      sort_order?: number;
      is_active?: boolean;
    } = {
      code: input.code,
      label: input.label,
      description: input.description ?? null,
      updated_by: ctx.actor.employeeId,
    };
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
    if (input.is_active !== undefined) patch.is_active = input.is_active;

    const { error } = await supabase
      .from("lookup_options")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(ADMIN_PAGE);
    revalidatePath("/finance/cash-advances");

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: {
        code: prev.code,
        label: prev.label,
        description: prev.description,
        sort_order: prev.sort_order,
        is_active: prev.is_active,
      },
      auditNewValues: patch,
    };
  },
});

// ---------------------------------------------------------------------------
// TOGGLE ACTIVE — soft delete / restore.
// ---------------------------------------------------------------------------

export const toggleLookupOptionActiveAction = withSecureAction({
  schema: toggleLookupOptionActiveSchema,
  resource: "lookup_option",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "lookup_options",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: prev } = await supabase
      .from("lookup_options")
      .select("id, is_active")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (!prev) throw new Error("Lookup option not found.");

    const { error } = await supabase
      .from("lookup_options")
      .update({
        is_active: input.is_active,
        updated_by: ctx.actor.employeeId,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(ADMIN_PAGE);
    revalidatePath("/finance/cash-advances");

    return {
      result: { id: input.id, is_active: input.is_active },
      auditResourceId: input.id,
      auditOldValues: { is_active: prev.is_active },
      auditNewValues: { is_active: input.is_active },
    };
  },
});

// ---------------------------------------------------------------------------
// DELETE (hard) — for typo-cleanup only. Downstream tables store the
// label as text snapshot so no FK cascade is needed.
// ---------------------------------------------------------------------------

export const deleteLookupOptionAction = withSecureAction({
  schema: deleteLookupOptionSchema,
  resource: "lookup_option",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "lookup_options",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: prev } = await supabase
      .from("lookup_options")
      .select("id, domain, code, label")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (!prev) throw new Error("Lookup option not found.");

    const { error } = await supabase
      .from("lookup_options")
      .delete()
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(ADMIN_PAGE);
    revalidatePath("/finance/cash-advances");

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: {
        domain: prev.domain,
        code: prev.code,
        label: prev.label,
      },
    };
  },
});
