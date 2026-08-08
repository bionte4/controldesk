import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./common";

// ---------------------------------------------------------------------------
// Shifts (rules §12)
// ---------------------------------------------------------------------------
// `project_id` is optional:
//   - NULL / undefined ⇒ tenant-wide base catalog (HR/OM only, per PDP).
//   - UUID             ⇒ project-scoped override (PM/SPV assigned to
//                        that project may write; allowance is force-
//                        inherited from base by DB trigger — see
//                        migration 0066).
// `shift_allowance_idr` is optional; PDP + DB trigger strip / override
// it for PM/SPV, so a form omitting it is valid.
export const createWorkShiftSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Shift code must be at least 2 characters.")
    .max(20)
    .regex(/^[A-Z0-9_-]+$/i, "Use letters, digits, underscore or hyphen.")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(80),
  start_time: z.string().regex(/^\d{2}:\d{2}$/u, "Use HH:mm."),
  end_time: z.string().regex(/^\d{2}:\d{2}$/u, "Use HH:mm."),
  duration_hours: z.coerce.number().min(0.5).max(24),
  shift_allowance_idr: z.coerce
    .number()
    .min(0)
    .max(500_000_000)
    .optional()
    .default(0),
  is_night: z.boolean().default(false),
  project_id: uuidSchema.optional().nullable(),
});
export type CreateWorkShiftInput = z.infer<typeof createWorkShiftSchema>;

export const updateWorkShiftSchema = createWorkShiftSchema.extend({
  id: uuidSchema,
});
export type UpdateWorkShiftInput = z.infer<typeof updateWorkShiftSchema>;

export const deleteWorkShiftSchema = z.object({
  id: uuidSchema,
});
export type DeleteWorkShiftInput = z.infer<typeof deleteWorkShiftSchema>;

// ---------------------------------------------------------------------------
// Rosters (rules §12)
// ---------------------------------------------------------------------------
export const ROSTER_STATUSES = ["PLANNED", "LEAVE", "SICK", "OFF"] as const;
export const rosterStatusSchema = z.enum(ROSTER_STATUSES);

export const upsertRosterEntrySchema = z.object({
  employee_id: uuidSchema,
  shift_id: uuidSchema,
  project_id: uuidSchema.optional().nullable(),
  work_date: isoDateSchema,
  status: rosterStatusSchema.default("PLANNED"),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});
export type UpsertRosterEntryInput = z.infer<typeof upsertRosterEntrySchema>;

export const deleteRosterEntrySchema = z.object({
  id: uuidSchema,
});
export type DeleteRosterEntryInput = z.infer<typeof deleteRosterEntrySchema>;

// ---------------------------------------------------------------------------
// Timesheets (rules §14)
// ---------------------------------------------------------------------------
export const submitTimesheetSchema = z.object({
  employee_id: uuidSchema,
  project_id: uuidSchema.optional().nullable(),
  roster_id: uuidSchema.optional().nullable(),
  work_date: isoDateSchema,
  hours_worked: z.coerce.number().min(0).max(24),
  hours_overtime: z.coerce.number().min(0).max(12).default(0),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});
export type SubmitTimesheetInput = z.infer<typeof submitTimesheetSchema>;

export const approveTimesheetSchema = z.object({
  id: uuidSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type ApproveTimesheetInput = z.infer<typeof approveTimesheetSchema>;

export const rejectTimesheetSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().min(4).max(1000),
});
export type RejectTimesheetInput = z.infer<typeof rejectTimesheetSchema>;

// ---------------------------------------------------------------------------
// Payroll (rules §14)
// ---------------------------------------------------------------------------
export const generatePayrollPeriodSchema = z.object({
  period_year: z.number().int().min(2020).max(2100),
  period_month: z.number().int().min(1).max(12),
});
export type GeneratePayrollPeriodInput = z.infer<
  typeof generatePayrollPeriodSchema
>;

export const finalizePayrollPeriodSchema = z.object({
  id: uuidSchema,
});
export type FinalizePayrollPeriodInput = z.infer<
  typeof finalizePayrollPeriodSchema
>;
