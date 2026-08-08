"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import {
  createEmployeeSchema,
  setEmployeeAvailabilitySchema,
  updateEmployeeSchema,
} from "@/lib/validation/employee";

/**
 * Compose the display full_name column from first/last. Keeps the legacy
 * `full_name` column consistent so roster, timesheets, payroll, and the
 * approval inbox continue to render without changes.
 */
function composeFullName(first: string, last?: string | null): string {
  const clean = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return clean.join(" ");
}

/**
 * Create a new employee (rules §6 people directory + §12 HR).
 *
 * PDP: HR_ADMIN or TENANT_ADMIN only (see `decideEmployee` in pdp.ts).
 * DB trigger auto-fills `contract_end_date` when employment_type = PERMANENT
 * and `date_of_birth` is provided but `contract_end_date` is left blank.
 */
export const createEmployeeAction = withSecureAction({
  schema: createEmployeeSchema,
  resource: "employee",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "employees",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const fullName = composeFullName(input.first_name, input.last_name);
    if (!fullName) {
      throw new Error("First name is required.");
    }

    const { data, error } = await supabase
      .from("employees")
      .insert({
        tenant_id: ctx.actor.tenantId,
        first_name: input.first_name,
        last_name: input.last_name ?? null,
        full_name: fullName,
        email: input.email,
        phone: input.phone ?? null,
        department: input.department ?? null,
        position_title: input.position_title ?? null,
        role: input.role,
        date_of_birth: input.date_of_birth ?? null,
        join_date: input.join_date,
        employment_type: input.employment_type,
        contract_end_date: input.contract_end_date ?? null,
        availability: input.availability,
        reports_to_employee_id: input.reports_to_employee_id ?? null,
        is_active: input.availability !== "INACTIVE",
      })
      .select(
        "id, full_name, email, employment_type, contract_end_date, availability",
      )
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create employee.");
    }

    revalidatePath("/hr/employees");

    return {
      result: {
        id: data.id,
        full_name: data.full_name,
        email: data.email,
        employment_type: data.employment_type,
        contract_end_date: data.contract_end_date,
      },
      auditResourceId: data.id,
      auditNewValues: {
        full_name: data.full_name,
        email: data.email,
        role: input.role,
        employment_type: data.employment_type,
        join_date: input.join_date,
        contract_end_date: data.contract_end_date,
        department: input.department ?? null,
        position_title: input.position_title ?? null,
      },
    };
  },
});

/**
 * Update an existing employee (rules §6 people directory).
 */
export const updateEmployeeAction = withSecureAction({
  schema: updateEmployeeSchema,
  resource: "employee",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "employees",
  resolveAttributes: async (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    ownerEmployeeId: input.id,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("employees")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) {
      throw new Error(readErr?.message ?? "Employee not found.");
    }

    const fullName = composeFullName(input.first_name, input.last_name);
    if (!fullName) {
      throw new Error("First name is required.");
    }

    const patch: TablesUpdate<"employees"> = {
      first_name: input.first_name,
      last_name: input.last_name ?? null,
      full_name: fullName,
      email: input.email,
      phone: input.phone ?? null,
      department: input.department ?? null,
      position_title: input.position_title ?? null,
      role: input.role,
      date_of_birth: input.date_of_birth ?? null,
      join_date: input.join_date,
      employment_type: input.employment_type,
      // For PERMANENT: if UI cleared the end date, let the trigger recompute
      // from DOB. For non-PERMANENT the Zod schema already required a value.
      contract_end_date: input.contract_end_date ?? null,
      availability: input.availability,
      reports_to_employee_id: input.reports_to_employee_id ?? null,
      is_active: input.availability !== "INACTIVE",
    };

    const { data, error } = await supabase
      .from("employees")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select(
        "id, full_name, email, employment_type, contract_end_date, availability",
      )
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update employee.");
    }

    revalidatePath("/hr/employees");

    return {
      result: {
        id: data.id,
        full_name: data.full_name,
        contract_end_date: data.contract_end_date,
      },
      auditResourceId: data.id,
      auditOldValues: {
        full_name: existing.full_name,
        email: existing.email,
        role: existing.role,
        employment_type: existing.employment_type,
        contract_end_date: existing.contract_end_date,
        availability: existing.availability,
      },
      auditNewValues: {
        full_name: data.full_name,
        email: data.email,
        role: input.role,
        employment_type: data.employment_type,
        contract_end_date: data.contract_end_date,
        availability: data.availability,
      },
    };
  },
});

/**
 * Quick availability toggle (Available / Assigned / On leave / Inactive)
 * without touching the rest of the employee record. Used from the row menu.
 */
export const setEmployeeAvailabilityAction = withSecureAction({
  schema: setEmployeeAvailabilitySchema,
  resource: "employee",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "employees",
  resolveAttributes: async (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    ownerEmployeeId: input.id,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("employees")
      .select("availability, full_name")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) {
      throw new Error(readErr?.message ?? "Employee not found.");
    }

    const { error } = await supabase
      .from("employees")
      .update({
        availability: input.availability,
        is_active: input.availability !== "INACTIVE",
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath("/hr/employees");

    return {
      result: { id: input.id, availability: input.availability },
      auditResourceId: input.id,
      auditOldValues: { availability: existing.availability },
      auditNewValues: { availability: input.availability },
    };
  },
});
