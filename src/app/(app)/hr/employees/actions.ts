"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import {
  encryptEmployeePii,
  hashEmployeeNik,
  toBytea,
} from "@/lib/security/employee-pii";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import {
  createEmployeeSchema,
  setEmployeeAvailabilitySchema,
  updateEmployeeSchema,
} from "@/lib/validation/employee";
import { assertTenantCapacity } from "@/lib/ops/entitlements";

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

    await assertTenantCapacity({
      client: supabase,
      tenantId: ctx.actor.tenantId,
      capability: "active_users",
      table: "employees",
      activeFilter: { column: "is_active", equals: true },
    });

    const fullName = composeFullName(input.first_name, input.last_name);
    if (!fullName) {
      throw new Error("First name is required.");
    }

    // Encrypt PII fields at the Node boundary (rules §3). NIK also
    // gets a blind-index hash for the `(tenant_id, nik_hash)` unique
    // constraint — if a duplicate slips through the pre-check below,
    // the DB rejects it with 23505 as a last line of defence.
    const nikEnc = encryptEmployeePii(input.nik);
    const nikHash = hashEmployeeNik({
      nik: input.nik ?? null,
      tenantId: ctx.actor.tenantId,
    });

    // Pre-check for duplicate NIK — better UX than catching the raw
    // 23505 unique_violation error. Uses supabase-js equality on the
    // bytea column via `\\x<hex>` wire format.
    if (nikHash) {
      const { data: duplicate } = await supabase
        .from("employees")
        .select("id")
        .eq("tenant_id", ctx.actor.tenantId)
        .eq("nik_hash", toBytea(nikHash) as string)
        .maybeSingle();
      if (duplicate) {
        throw new Error("Karyawan dengan NIK ini sudah terdaftar di tenant.");
      }
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
        nik_enc: nikEnc,
        nik_hash: toBytea(nikHash),
        division: input.division ?? null,
        department: input.department ?? null,
        position_title: input.position_title ?? null,
        client_display_name: input.client_display_name ?? null,
        // `bank_account_number_enc` intentionally omitted — column
        // defaults to NULL. There's no UI wire-up for bank account
        // yet; the column exists so a future HR-facing form can
        // encrypt inline via the same `encryptEmployeePii()` helper.
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
        // NIK plaintext intentionally NOT logged — even though
        // `SENSITIVE_KEYS` would redact it, passing the value at
        // all creates a needless surface (memory dumps, log
        // aggregators). Record just whether it was set/cleared:
        nik_present: Boolean(input.nik),
        division: input.division ?? null,
        department: input.department ?? null,
        position_title: input.position_title ?? null,
        client_display_name: input.client_display_name ?? null,
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

    // Explicit column list (was `select("*")` pre-migration 0100 which
    // REVOKE'd table-level SELECT and forced column-level enumeration).
    // Only the fields read below (`existing.<field>`) + `id` for the
    // audit key. Adding a new consumed field? Add it here too.
    const { data: existing, error: readErr } = await supabase
      .from("employees")
      .select(
        `id, full_name, email, role, employment_type, contract_end_date,
         availability, nik_enc, division, department, client_display_name`,
      )
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

    // Same PII wire-up as create — encrypt at boundary, hash for the
    // uniqueness constraint. Duplicate pre-check excludes the current
    // row so re-submitting the edit sheet without changing NIK
    // doesn't self-conflict.
    const nikEnc = encryptEmployeePii(input.nik);
    const nikHash = hashEmployeeNik({
      nik: input.nik ?? null,
      tenantId: ctx.actor.tenantId,
    });
    if (nikHash) {
      const { data: duplicate } = await supabase
        .from("employees")
        .select("id")
        .eq("tenant_id", ctx.actor.tenantId)
        .eq("nik_hash", toBytea(nikHash) as string)
        .neq("id", input.id)
        .maybeSingle();
      if (duplicate) {
        throw new Error("Karyawan lain dengan NIK ini sudah terdaftar.");
      }
    }

    const patch: TablesUpdate<"employees"> = {
      first_name: input.first_name,
      last_name: input.last_name ?? null,
      full_name: fullName,
      email: input.email,
      phone: input.phone ?? null,
      nik_enc: nikEnc,
      nik_hash: toBytea(nikHash),
      division: input.division ?? null,
      department: input.department ?? null,
      position_title: input.position_title ?? null,
      client_display_name: input.client_display_name ?? null,
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
        // NIK values NEVER captured plaintext or ciphertext. Log
        // just whether it was set so we can trace "someone cleared
        // the NIK" events without leaking the value.
        nik_present: Boolean(existing.nik_enc),
        division: existing.division,
        department: existing.department,
        client_display_name: existing.client_display_name,
      },
      auditNewValues: {
        full_name: data.full_name,
        email: data.email,
        role: input.role,
        employment_type: data.employment_type,
        contract_end_date: data.contract_end_date,
        availability: data.availability,
        nik_present: Boolean(input.nik),
        division: input.division ?? null,
        department: input.department ?? null,
        client_display_name: input.client_display_name ?? null,
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
