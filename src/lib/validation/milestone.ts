import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./common";

/**
 * Zod schemas for the project_milestones module (rules §6 GAS align).
 *
 * Aligned with `supabase/migrations/0022_projects_gas_align.sql`.
 *
 * Weight is stored in basis points (`weight_bps`) so 25.50% = 2550. The DB
 * check constraint enforces `weight_bps between 1 and 10000`; the app layer
 * additionally guards that Σ weight_bps ≤ 10_000 per project (see
 * `assertBudgetWithinBudget()` in `src/lib/milestones/state.ts`).
 */

export const MILESTONE_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "AT_RISK",
  "DONE",
  "CANCELLED",
] as const;
export const milestoneStatusSchema = z.enum(MILESTONE_STATUSES);
export type MilestoneStatusInput = z.infer<typeof milestoneStatusSchema>;

/** Basis-point unit — 1 bps = 0.01%, so 100% = 10_000. */
export const weightBpsSchema = z
  .number({ message: "Weight must be a number." })
  .int("Weight must be whole basis points (1 bps = 0.01%).")
  .min(1, "Weight must be at least 1 bps (0.01%).")
  .max(10_000, "Weight cannot exceed 10 000 bps (100%).");

export const createMilestoneSchema = z
  .object({
    project_id: uuidSchema,
    seq: z
      .number()
      .int("Sequence must be a whole number.")
      .positive("Sequence must be > 0."),
    name: z
      .string()
      .trim()
      .min(2, "Name is too short.")
      .max(200, "Name is too long."),
    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((val) => (val === "" ? undefined : val)),
    weight_bps: weightBpsSchema,
    planned_start_date: isoDateSchema.optional(),
    planned_end_date: isoDateSchema.optional(),
    owner_employee_id: uuidSchema.optional(),
  })
  .refine(
    (v) =>
      !v.planned_start_date ||
      !v.planned_end_date ||
      v.planned_end_date >= v.planned_start_date,
    {
      path: ["planned_end_date"],
      message: "Planned end date must be on or after the planned start date.",
    },
  );
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;

export const updateMilestoneSchema = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(2).max(200).optional(),
    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((val) => (val === "" ? undefined : val)),
    weight_bps: weightBpsSchema.optional(),
    planned_start_date: isoDateSchema.optional().nullable(),
    planned_end_date: isoDateSchema.optional().nullable(),
    owner_employee_id: uuidSchema.optional().nullable(),
    seq: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      !v.planned_start_date ||
      !v.planned_end_date ||
      v.planned_end_date >= v.planned_start_date,
    {
      path: ["planned_end_date"],
      message: "Planned end date must be on or after the planned start date.",
    },
  );
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

export const setMilestoneStatusSchema = z
  .object({
    id: uuidSchema,
    status: milestoneStatusSchema,
    actual_start_date: isoDateSchema.optional(),
    actual_end_date: isoDateSchema.optional(),
  })
  .refine(
    (v) =>
      !v.actual_start_date ||
      !v.actual_end_date ||
      v.actual_end_date >= v.actual_start_date,
    {
      path: ["actual_end_date"],
      message: "Actual end date must be on or after the actual start date.",
    },
  );
export type SetMilestoneStatusInput = z.infer<typeof setMilestoneStatusSchema>;

export const deleteMilestoneSchema = z.object({
  id: uuidSchema,
});
export type DeleteMilestoneInput = z.infer<typeof deleteMilestoneSchema>;
