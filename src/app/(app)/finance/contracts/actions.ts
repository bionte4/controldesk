"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { moneyToDbString } from "@/lib/format/money";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import {
  createContractSchema,
  updateContractSchema,
  type CreateContractInput,
} from "@/lib/validation/client";

/**
 * Create a new BPO contract row (rules §5).
 *
 * PDP: LEAD_FINANCE, HEAD_MANAGER, GENERAL_MANAGER, TENANT_ADMIN.
 * Money handling: input is `number` (integer IDR) — converted to
 * `numeric(18,2)` via `moneyToDbString(BigInt(...))` (rules §18).
 */
export const createBpoContractAction = withSecureAction({
  schema: createContractSchema,
  resource: "bpo_contract",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "bpo_contracts",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input: CreateContractInput, ctx) => {
    const supabase = await createClient();

    // Verify client belongs to the caller's tenant (RLS also enforces this,
    // but we short-circuit for a nicer error surface than 42501).
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id")
      .eq("id", input.client_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (clientErr || !client) {
      throw new Error("Client not found in this tenant.");
    }

    const { data, error } = await supabase
      .from("bpo_contracts")
      .insert({
        tenant_id: ctx.actor.tenantId,
        client_id: input.client_id,
        contract_number: input.contract_number,
        // Numeric columns are strings via PostgREST; the generated types
        // incorrectly widen to `number`. Casting matches the convention
        // used throughout finance/actions.ts (rules §18).
        mrr_amount: moneyToDbString(
          BigInt(input.mrr_amount_idr),
        ) as unknown as number,
        currency: "IDR",
        start_date: input.start_date,
        end_date: input.end_date ?? null,
        status: input.status,
        notes: input.notes ?? null,
      })
      .select("id, contract_number, status")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create contract.");
    }

    revalidatePath("/finance/contracts");
    revalidatePath(`/clients/${input.client_id}`);

    return {
      result: {
        id: data.id,
        contract_number: data.contract_number,
        status: data.status,
      },
      auditResourceId: data.id,
      auditNewValues: {
        contract_number: data.contract_number,
        status: data.status,
      },
    };
  },
});

/**
 * Update an existing BPO contract. Partial patch — only fields that are
 * explicitly supplied are written. `null` on `end_date` / `notes` clears
 * the column (distinct from `undefined` which means "no change").
 */
export const updateBpoContractAction = withSecureAction({
  schema: updateContractSchema,
  resource: "bpo_contract",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "bpo_contracts",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const employee = await requireCurrentEmployee();
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("bpo_contracts")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", employee.tenant_id)
      .single();

    if (readErr || !existing) {
      throw new Error(readErr?.message ?? "Contract not found.");
    }

    const patch: TablesUpdate<"bpo_contracts"> = {};
    if (input.contract_number !== undefined)
      patch.contract_number = input.contract_number;
    if (input.mrr_amount_idr !== undefined)
      patch.mrr_amount = moneyToDbString(
        BigInt(input.mrr_amount_idr),
      ) as unknown as number;
    if (input.start_date !== undefined) patch.start_date = input.start_date;
    if (input.end_date !== undefined) patch.end_date = input.end_date ?? null;
    if (input.status !== undefined) patch.status = input.status;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;

    const { data, error } = await supabase
      .from("bpo_contracts")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select("id, contract_number, status, client_id")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update contract.");
    }

    revalidatePath("/finance/contracts");
    revalidatePath(`/finance/contracts/${data.id}`);
    revalidatePath(`/clients/${data.client_id}`);

    return {
      result: {
        id: data.id,
        contract_number: data.contract_number,
        status: data.status,
      },
      auditResourceId: data.id,
      auditOldValues: {
        contract_number: existing.contract_number,
        status: existing.status,
      },
      auditNewValues: {
        contract_number: data.contract_number,
        status: data.status,
      },
    };
  },
});
