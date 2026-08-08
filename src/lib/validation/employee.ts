import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./common";

/**
 * Employee HR directory — rules §6 + §12.
 *
 * Business rules encoded here:
 *   * `first_name` required, `last_name` optional (single-name employees).
 *   * `email` unique per tenant (enforced at DB layer).
 *   * `join_date` required, ISO date.
 *   * For non-PERMANENT contracts (CONTRACT / PROBATION / INTERN / OUTSOURCE /
 *     OUTTASK) `contract_end_date` is REQUIRED and must be ≥ join_date. This
 *     drives the contract-expiry reminder cron.
 *   * For PERMANENT contracts `contract_end_date` is optional at the UI layer;
 *     the DB trigger auto-fills it from `date_of_birth + tenants.retirement_age`
 *     when left blank. Users may still supply a manual end date (e.g. planned
 *     early retirement) and it will be respected as-is.
 *   * `date_of_birth`, when supplied, must be at least 17 years in the past
 *     (Indonesian minimum working age) and at most 90 years — defensive.
 */

export const EMPLOYMENT_TYPES = [
  "PERMANENT",
  "CONTRACT",
  "PROBATION",
  "INTERN",
  "OUTSOURCE",
  "OUTTASK",
] as const;
export type EmploymentTypeInput = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYEE_AVAILABILITIES = [
  "AVAILABLE",
  "ASSIGNED",
  "ON_LEAVE",
  "INACTIVE",
] as const;
export type EmployeeAvailabilityInput = (typeof EMPLOYEE_AVAILABILITIES)[number];

export const EMPLOYEE_ROLES = [
  "EMPLOYEE",
  "SUPERVISOR",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "PETTY_CASH_CUSTODIAN",
  "LEAD_FINANCE",
  "HR_ADMIN",
  "TENANT_ADMIN",
] as const;
export type EmployeeRoleInput = (typeof EMPLOYEE_ROLES)[number];

/** Requires end_date whenever employment_type ≠ PERMANENT. */
export const NON_PERMANENT_TYPES: readonly EmploymentTypeInput[] = [
  "CONTRACT",
  "PROBATION",
  "INTERN",
  "OUTSOURCE",
  "OUTTASK",
] as const;

const optionalTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .email("Enter a valid email address.")
  .transform((v) => v.toLowerCase());

const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^[+()\d\s-]+$/u, "Phone may only contain digits, spaces, +, -, ().")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

// ---------------------------------------------------------------------------
// Create schema
// ---------------------------------------------------------------------------
export const createEmployeeSchema = z
  .object({
    first_name: z.string().trim().min(1, "First name is required.").max(80),
    last_name: optionalTrimmedText(80),
    email: emailSchema,
    phone: phoneSchema,
    department: optionalTrimmedText(120),
    position_title: optionalTrimmedText(120),
    role: z.enum(EMPLOYEE_ROLES).default("EMPLOYEE"),
    date_of_birth: isoDateSchema.optional(),
    join_date: isoDateSchema,
    employment_type: z.enum(EMPLOYMENT_TYPES).default("PERMANENT"),
    contract_end_date: isoDateSchema.optional(),
    availability: z.enum(EMPLOYEE_AVAILABILITIES).default("AVAILABLE"),
    reports_to_employee_id: uuidSchema.optional(),
    notes: optionalTrimmedText(500),
  })
  .superRefine((val, ctx) => {
    // Non-permanent contracts must supply an end date up-front.
    if (NON_PERMANENT_TYPES.includes(val.employment_type)) {
      if (!val.contract_end_date) {
        ctx.addIssue({
          code: "custom",
          path: ["contract_end_date"],
          message:
            "End date is required for Contract, Probation, Intern, Outsource, and Outtask employees.",
        });
      }
    }
    // End date, if given, must not precede join date.
    if (
      val.contract_end_date &&
      val.contract_end_date < val.join_date
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["contract_end_date"],
        message: "End date must be on or after the join date.",
      });
    }
    // DOB, if given, must be a plausible birth date.
    if (val.date_of_birth) {
      const dob = new Date(`${val.date_of_birth}T00:00:00Z`);
      const now = Date.now();
      const ageMs = now - dob.getTime();
      const yearMs = 365.25 * 86_400_000;
      const ageYears = ageMs / yearMs;
      if (ageYears < 17) {
        ctx.addIssue({
          code: "custom",
          path: ["date_of_birth"],
          message: "Employee must be at least 17 years old.",
        });
      }
      if (ageYears > 90) {
        ctx.addIssue({
          code: "custom",
          path: ["date_of_birth"],
          message: "Date of birth looks invalid (age > 90).",
        });
      }
    }
    // Permanent + DOB provided: nothing else required.
    // Permanent + no DOB + no manual end date: end date stays null; trigger
    // won't compute anything — the app treats that as "no fixed retirement
    // date on file yet" and won't send reminders.
  });

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

// ---------------------------------------------------------------------------
// Update schema — same shape, id required.
// ---------------------------------------------------------------------------
export const updateEmployeeSchema = createEmployeeSchema.extend({
  id: uuidSchema,
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

// ---------------------------------------------------------------------------
// Toggle availability (soft disable etc.)
// ---------------------------------------------------------------------------
export const setEmployeeAvailabilitySchema = z.object({
  id: uuidSchema,
  availability: z.enum(EMPLOYEE_AVAILABILITIES),
});
export type SetEmployeeAvailabilityInput = z.infer<
  typeof setEmployeeAvailabilitySchema
>;
