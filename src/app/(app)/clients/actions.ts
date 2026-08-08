"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import {
  createClientSchema,
  updateClientSchema,
  type CreateClientInput,
} from "@/lib/validation/client";

/**
 * Create a new client account (rules §6).
 *
 * PDP: only OM+ / TENANT_ADMIN can create clients.
 */
export const createClientAction = withSecureAction({
  schema: createClientSchema,
  resource: "client",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "clients",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input: CreateClientInput, ctx) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("clients")
      .insert({
        tenant_id: ctx.actor.tenantId,
        name: input.name,
        industry: input.industry ?? null,
        contact_name: input.contact_name ?? null,
        contact_email: input.contact_email ?? null,
        contact_phone: input.contact_phone ?? null,
        status: input.status,
        contract_number: input.contract_number ?? null,
        project_code: input.project_code ?? null,
        notes: input.notes ?? null,
      })
      .select("id, name, status")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create client.");
    }

    revalidatePath("/clients");

    return {
      result: { id: data.id, name: data.name, status: data.status },
      auditResourceId: data.id,
      auditNewValues: { name: data.name, status: data.status },
    };
  },
});

/**
 * Update an existing client (rules §6).
 */
export const updateClientAction = withSecureAction({
  schema: updateClientSchema,
  resource: "client",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "clients",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const employee = await requireCurrentEmployee();
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", employee.tenant_id)
      .single();

    if (readErr || !existing) {
      throw new Error(readErr?.message ?? "Client not found.");
    }

    const patch: TablesUpdate<"clients"> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.industry !== undefined) patch.industry = input.industry ?? null;
    if (input.contact_name !== undefined)
      patch.contact_name = input.contact_name ?? null;
    if (input.contact_email !== undefined)
      patch.contact_email = input.contact_email ?? null;
    if (input.contact_phone !== undefined)
      patch.contact_phone = input.contact_phone ?? null;
    if (input.status !== undefined) patch.status = input.status;
    if (input.contract_number !== undefined)
      patch.contract_number = input.contract_number ?? null;
    if (input.project_code !== undefined)
      patch.project_code = input.project_code ?? null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;

    const { data, error } = await supabase
      .from("clients")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select("id, name, status")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update client.");
    }

    revalidatePath("/clients");
    revalidatePath(`/clients/${data.id}`);

    return {
      result: { id: data.id, name: data.name, status: data.status },
      auditResourceId: data.id,
      auditOldValues: {
        name: existing.name,
        status: existing.status,
      },
      auditNewValues: {
        name: data.name,
        status: data.status,
      },
    };
  },
});
