import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for the projects module (rules §7).
 *
 * Aligned with `supabase/migrations/0008_clients_and_projects.sql`.
 */

export const PROJECT_STATUSES = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

const projectCode = z
  .string()
  .trim()
  .min(2, "Project code must be at least 2 characters.")
  .max(32, "Project code is too long.")
  .regex(
    /^[A-Z0-9][A-Z0-9-]*$/i,
    "Only letters, digits, and dashes are allowed.",
  );

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD).");

const projectBaseSchema = z.object({
  client_id: uuidSchema,
  contract_id: uuidSchema.optional(),
  code: projectCode,
  name: z.string().trim().min(2, "Name is too short.").max(160),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  status: projectStatusSchema.default("PLANNING"),
  start_date: isoDateSchema.optional(),
  end_date: isoDateSchema.optional(),
});

export const createProjectSchema = projectBaseSchema.refine(
  (v) => !v.end_date || !v.start_date || v.end_date >= v.start_date,
  { path: ["end_date"], message: "End date must be on or after start date." },
);
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = projectBaseSchema
  .partial()
  .extend({ id: uuidSchema });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// ---------------------------------------------------------------------------
// Assignment schemas (rules §7).
// ---------------------------------------------------------------------------

export const PM_ASSIGNMENT_ROLES = ["PRIMARY_PM", "CO_PM"] as const;
export const pmAssignmentRoleSchema = z.enum(PM_ASSIGNMENT_ROLES);

export const createPmAssignmentSchema = z.object({
  project_id: uuidSchema,
  pm_employee_id: uuidSchema,
  assignment_role: pmAssignmentRoleSchema.default("PRIMARY_PM"),
});
export type CreatePmAssignmentInput = z.infer<typeof createPmAssignmentSchema>;

export const createEmployeeAssignmentSchema = z.object({
  project_id: uuidSchema,
  employee_id: uuidSchema,
  allocation_percentage: z
    .number()
    .int("Allocation percentage must be a whole number.")
    .min(1, "Allocation must be at least 1%.")
    .max(100, "Allocation cannot exceed 100%."),
});
export type CreateEmployeeAssignmentInput = z.infer<
  typeof createEmployeeAssignmentSchema
>;

// ---------------------------------------------------------------------------
// Budget (rules §7).
// ---------------------------------------------------------------------------

export const upsertProjectBudgetSchema = z.object({
  project_id: uuidSchema,
  budget_amount_idr: z
    .number()
    .int("Budget must be a whole rupiah amount.")
    .nonnegative("Budget cannot be negative."),
});
export type UpsertProjectBudgetInput = z.infer<typeof upsertProjectBudgetSchema>;
