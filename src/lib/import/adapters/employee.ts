import "server-only";

import { z } from "zod";

import { resolveLookup } from "../resolver";
import type { ImportAdapter } from "../types";

const EMPLOYMENT_TYPES = [
  "PERMANENT",
  "CONTRACT",
  "PROBATION",
  "INTERN",
  "OUTSOURCE",
  "OUTTASK",
] as const;

const AVAILABILITY_TYPES = [
  "AVAILABLE",
  "ASSIGNED",
  "ON_LEAVE",
  "INACTIVE",
] as const;

/**
 * Row-shape after resolver runs. IDs are lookups already resolved; the
 * committer just needs to feed this straight into `insert()` or
 * `update()`.
 */
type EmployeeCommit = {
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department: string; // lookup label (kept for legacy visibility)
  position_title: string; // lookup label
  join_date: string; // yyyy-mm-dd
  employment_type: (typeof EMPLOYMENT_TYPES)[number];
  contract_end_date: string | null;
  availability: (typeof AVAILABILITY_TYPES)[number];
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
};

// Zod row schema — validates the RAW cell shape (post-CSV/XLSX parse)
// BEFORE we swap codes for names / IDs. Kept intentionally light so
// missing-code errors surface as "not in reference data" rather than
// "invalid type".
const rowSchema = z.object({
  firstname: z.string().trim().min(1),
  lastname: z.string().trim().min(1),
  email: z
    .string()
    .trim()
    .email("Not a valid email address."),
  phone: z.string().trim().optional().default(""),
  departmentcode: z.string().trim().min(1),
  positioncode: z.string().trim().min(1),
  joindate: z
    .string()
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/u,
      "Use ISO date (yyyy-mm-dd), e.g. 2026-01-15.",
    ),
  employmentstatus: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine(
      (v) => v === "" || EMPLOYMENT_TYPES.includes(v as (typeof EMPLOYMENT_TYPES)[number]),
      `Must be one of: ${EMPLOYMENT_TYPES.join(", ")} (or empty for PERMANENT)`,
    )
    .optional()
    .default(""),
  enddate: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/u, "Use ISO date (yyyy-mm-dd) or leave blank.")
    .optional()
    .default(""),
  availabilitystatus: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine(
      (v) => v === "" || AVAILABILITY_TYPES.includes(v as (typeof AVAILABILITY_TYPES)[number]),
      `Must be one of: ${AVAILABILITY_TYPES.join(", ")} (or empty for AVAILABLE)`,
    )
    .optional()
    .default(""),
  emergencycontactname: z.string().trim().optional().default(""),
  emergencycontactphone: z.string().trim().optional().default(""),
  notes: z.string().trim().optional().default(""),
});

export const employeeAdapter: ImportAdapter<EmployeeCommit> = {
  resource: "EMPLOYEE",
  columns: [
    { key: "firstname", label: "First Name", type: "string", required: true, example: "John" },
    { key: "lastname", label: "Last Name", type: "string", required: true, example: "Doe" },
    { key: "email", label: "Email", type: "email", required: true, example: "john.doe@example.com" },
    { key: "phone", label: "Phone", type: "phone", required: false, example: "+62 812 3456 7890" },
    {
      key: "departmentcode",
      label: "Department Code",
      type: "ref",
      required: true,
      example: "ENG",
      refHint: "Must exist in Settings → Reference data → Department",
    },
    {
      key: "positioncode",
      label: "Position Code",
      type: "ref",
      required: true,
      example: "DEV-01",
      refHint: "Must exist in Settings → Reference data → Position",
    },
    { key: "joindate", label: "Join Date", type: "date", required: true, example: "2026-01-15" },
    {
      key: "employmentstatus",
      label: "Employment Status",
      type: "enum",
      required: false,
      example: "PERMANENT",
      enumValues: EMPLOYMENT_TYPES,
    },
    { key: "enddate", label: "End Date", type: "date", required: false, example: "2026-12-31" },
    {
      key: "availabilitystatus",
      label: "Availability",
      type: "enum",
      required: false,
      example: "AVAILABLE",
      enumValues: AVAILABILITY_TYPES,
    },
    { key: "emergencycontactname", label: "Emergency Contact Name", type: "string", required: false, example: "Jane Doe" },
    { key: "emergencycontactphone", label: "Emergency Contact Phone", type: "phone", required: false, example: "+62 812 0000 0000" },
    { key: "notes", label: "Notes", type: "string", required: false, example: "" },
  ],

  needs: { lookups: true, employees: true },

  validate: async ({ rows, maps }) => {
    const valid: ReturnType<typeof mkValid>[] = [];
    const errors: { row_number: number; field: string | null; message: string; raw?: string | null }[] = [];

    const seenEmails = new Set<string>();

    rows.forEach((raw, idx) => {
      const rowNumber = idx + 1;

      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) {
        for (const iss of parsed.error.issues) {
          errors.push({
            row_number: rowNumber,
            field: iss.path.join("."),
            message: iss.message,
            raw: (raw[iss.path.join(".")] as string) ?? null,
          });
        }
        return;
      }

      const row = parsed.data;

      // Cross-row: email uniqueness within file.
      const emailKey = row.email.toLowerCase();
      if (seenEmails.has(emailKey)) {
        errors.push({
          row_number: rowNumber,
          field: "email",
          message: "Duplicate email in this file.",
          raw: row.email,
        });
        return;
      }
      seenEmails.add(emailKey);

      // Ref resolution: department + position must exist as
      // active lookup_options entries under the matching domain.
      const deptId = resolveLookup(maps, "department", row.departmentcode);
      if (!deptId) {
        errors.push({
          row_number: rowNumber,
          field: "departmentcode",
          message: `Unknown department code. Add "${row.departmentcode.toUpperCase()}" in Settings → Reference data → Department first.`,
          raw: row.departmentcode,
        });
        return;
      }
      const posId = resolveLookup(maps, "position", row.positioncode);
      if (!posId) {
        errors.push({
          row_number: rowNumber,
          field: "positioncode",
          message: `Unknown position code. Add "${row.positioncode.toUpperCase()}" in Settings → Reference data → Position first.`,
          raw: row.positioncode,
        });
        return;
      }

      // Cross-field: end_date required when employment_type ≠ PERMANENT.
      const empType = (row.employmentstatus || "PERMANENT") as (typeof EMPLOYMENT_TYPES)[number];
      if (empType !== "PERMANENT" && !row.enddate) {
        errors.push({
          row_number: rowNumber,
          field: "enddate",
          message: `End Date is required when Employment Status is ${empType}.`,
          raw: row.enddate,
        });
        return;
      }

      // Build committer payload. `department` + `position_title` on
      // the DB row store the human label (not the ID) — legacy behaviour
      // preserved to keep existing UIs / reports working. The lookup
      // ID is retained only for validation.
      void deptId;
      void posId;

      const commit: EmployeeCommit = {
        full_name: `${row.firstname} ${row.lastname}`.trim(),
        first_name: row.firstname,
        last_name: row.lastname,
        email: row.email,
        phone: row.phone || null,
        department: row.departmentcode.toUpperCase(),
        position_title: row.positioncode.toUpperCase(),
        join_date: row.joindate,
        employment_type: empType,
        contract_end_date: row.enddate || null,
        availability: (row.availabilitystatus ||
          "AVAILABLE") as (typeof AVAILABILITY_TYPES)[number],
        emergency_contact_name: row.emergencycontactname || null,
        emergency_contact_phone: row.emergencycontactphone || null,
        notes: row.notes || null,
      };
      valid.push(mkValid(rowNumber, commit, emailKey));
    });

    return { valid, errors };
  },

  commit: async ({ valid, tenantId, supabase }) => {
    let inserted = 0;
    let updated = 0;

    // We iterate serially rather than issuing a single `upsert` because
    // (a) `email` uniqueness is per-tenant, (b) we need per-row insert
    // vs update counting for the report, and (c) the row count is
    // capped at 500 so the extra roundtrips are acceptable (~15-20s).
    for (const row of valid) {
      // Find existing by email (natural key).
      const { data: existing } = await supabase
        .from("employees")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("email", row.commit.email)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("employees")
          .update(row.commit)
          .eq("id", (existing as { id: string }).id)
          .eq("tenant_id", tenantId);
        if (error) throw new Error(`Row ${row.row_number}: ${error.message}`);
        updated++;
      } else {
        const { error } = await supabase
          .from("employees")
          .insert({
            ...row.commit,
            tenant_id: tenantId,
            // Role defaults to EMPLOYEE (rules §6). HR admin can promote
            // later via /settings/users. Salary + bank account are
            // deliberately NOT in the payload — sensitive fields must
            // be entered per employee.
          });
        if (error) throw new Error(`Row ${row.row_number}: ${error.message}`);
        inserted++;
      }
    }

    return { inserted, updated };
  },
};

// Little factory to keep the validator readable.
function mkValid(rowNumber: number, commit: EmployeeCommit, key: string) {
  return { row_number: rowNumber, commit, key };
}
