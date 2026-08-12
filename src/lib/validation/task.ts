import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./common";

/**
 * Zod schemas for the project_tasks (WBS) module.
 *
 * Aligned with `supabase/migrations/0075_project_tasks_wbs.sql`.
 *
 * Hierarchy rules:
 *   - `parent_task_id` (nullable) → self-reference for tree structure.
 *   - `milestone_id` (nullable) → optional Level-1 anchor.
 *   - `depends_on_task_id` (nullable) → single finish-to-start predecessor.
 *
 * Progress + weight are NOT auto-rolled up in the DB — the app derives
 * parent/milestone/project progress at read time in `buildTree()` (see
 * `src/lib/data/tasks.ts`).
 */

export const TASK_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "REVIEW",
  "DONE",
  "CANCELLED",
] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatusInput = z.infer<typeof taskStatusSchema>;

/** 0..100 percentage, stored as numeric(5,2) — 2 decimal places. */
const percentSchema = z
  .number({ message: "Value must be a number." })
  .min(0, "Value cannot be negative.")
  .max(100, "Value cannot exceed 100.")
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: "At most 2 decimal places.",
  });

const budgetAmountSchema = z
  .number({ message: "Budget must be a number." })
  .nonnegative("Budget cannot be negative.")
  .max(999_999_999_999.99, "Budget exceeds numeric(18,2) range.");

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
export const createTaskSchema = z
  .object({
    project_id: uuidSchema,
    parent_task_id: uuidSchema.optional().nullable(),
    milestone_id: uuidSchema.optional().nullable(),
    depends_on_task_id: uuidSchema.optional().nullable(),
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
    status: taskStatusSchema.optional(),
    progress_pct: percentSchema.optional(),
    weight_pct: percentSchema.optional(),
    planned_start_date: isoDateSchema.optional().nullable(),
    planned_end_date: isoDateSchema.optional().nullable(),
    owner_employee_id: uuidSchema.optional().nullable(),
    budget_amount: budgetAmountSchema.optional().nullable(),
    sort_order: z.number().int().min(0).optional(),
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
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// ---------------------------------------------------------------------------
// UPDATE — partial. Cannot change project_id (would require full tree
// re-parenting; do it via a dedicated flow if ever needed).
// ---------------------------------------------------------------------------
export const updateTaskSchema = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(2).max(200).optional(),
    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((val) => (val === "" ? undefined : val))
      .nullable()
      .optional(),
    milestone_id: uuidSchema.nullable().optional(),
    depends_on_task_id: uuidSchema.nullable().optional(),
    progress_pct: percentSchema.optional(),
    weight_pct: percentSchema.optional(),
    planned_start_date: isoDateSchema.nullable().optional(),
    planned_end_date: isoDateSchema.nullable().optional(),
    actual_start_date: isoDateSchema.nullable().optional(),
    actual_end_date: isoDateSchema.nullable().optional(),
    owner_employee_id: uuidSchema.nullable().optional(),
    budget_amount: budgetAmountSchema.nullable().optional(),
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
  )
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
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// ---------------------------------------------------------------------------
// SET STATUS — quick lifecycle transitions. Auto-stamps actual dates.
// ---------------------------------------------------------------------------
export const setTaskStatusSchema = z.object({
  id: uuidSchema,
  status: taskStatusSchema,
});
export type SetTaskStatusInput = z.infer<typeof setTaskStatusSchema>;

// ---------------------------------------------------------------------------
// SET PROGRESS — quick % update. If 0→x transition sets IN_PROGRESS,
// if x→100 sets DONE.
// ---------------------------------------------------------------------------
export const setTaskProgressSchema = z.object({
  id: uuidSchema,
  progress_pct: percentSchema,
});
export type SetTaskProgressInput = z.infer<typeof setTaskProgressSchema>;

// ---------------------------------------------------------------------------
// REORDER — change sort_order or reparent (move to a new parent).
// The handler recomputes dense sort_order for siblings on both sides.
// ---------------------------------------------------------------------------
export const reorderTaskSchema = z.object({
  id: uuidSchema,
  new_parent_task_id: uuidSchema.nullable().optional(),
  new_sort_order: z.number().int().min(0),
});
export type ReorderTaskInput = z.infer<typeof reorderTaskSchema>;

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
export const deleteTaskSchema = z.object({
  id: uuidSchema,
});
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;
