import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./common";

/**
 * Unified "assignment" validation. One shape drives both PM assignments
 * (project_pm_assignments — roles PRIMARY_PM / CO_PM) and non-PM member
 * assignments (project_employee_assignments — roles MEMBER, TECH_LEAD, …).
 *
 * The Zod layer intentionally does NOT try to enforce the 100% capacity
 * ceiling — that check must be atomic against ACTIVE rows in the DB. The
 * server action does a pre-flight query to surface a friendly error before
 * hitting the DB, then falls through to the trigger as the final guard
 * (rules §7 + §17.2).
 */

// ---------------------------------------------------------------------------
// Role enums — kept in sync with 0008_clients_and_projects.sql and
// 0043_assignments_role_and_notes.sql.
// ---------------------------------------------------------------------------

export const PM_ASSIGNMENT_ROLES = ["PRIMARY_PM", "CO_PM"] as const;
export type PmAssignmentRoleValue = (typeof PM_ASSIGNMENT_ROLES)[number];
export const pmAssignmentRoleSchema = z.enum(PM_ASSIGNMENT_ROLES);

export const PROJECT_MEMBER_ROLES = [
  "MEMBER",
  "TECH_LEAD",
  "DEVELOPER",
  "ENGINEER",
  "QA",
  "DESIGNER",
  "DEVOPS",
  "CONSULTANT",
  "SUPPORT",
  "SITE_SUPERVISOR",
] as const;
export type ProjectMemberRoleValue = (typeof PROJECT_MEMBER_ROLES)[number];
export const projectMemberRoleSchema = z.enum(PROJECT_MEMBER_ROLES);

/**
 * Unified role — a single field on the form that maps to either the PM
 * table or the member table. `assignmentKindFromRole` below is the router.
 */
export const ASSIGNMENT_ROLES = [
  ...PM_ASSIGNMENT_ROLES,
  ...PROJECT_MEMBER_ROLES,
] as const;
export type AssignmentRoleValue = (typeof ASSIGNMENT_ROLES)[number];
export const assignmentRoleSchema = z.enum(ASSIGNMENT_ROLES);

export type AssignmentKind = "pm" | "member";

export function isPmRole(role: AssignmentRoleValue): role is PmAssignmentRoleValue {
  return (PM_ASSIGNMENT_ROLES as readonly string[]).includes(role);
}

export function isMemberRole(role: AssignmentRoleValue): role is ProjectMemberRoleValue {
  return !isPmRole(role);
}

export function assignmentKindFromRole(role: AssignmentRoleValue): AssignmentKind {
  return isPmRole(role) ? "pm" : "member";
}

// ---------------------------------------------------------------------------
// Base + create/update/end schemas.
// ---------------------------------------------------------------------------

/**
 * Trim + collapse empty-string → undefined for optional text fields. Zod v4
 * evaluates the union in order: an empty string matches the literal first
 * and is transformed to undefined; anything else falls through to the
 * trimmed non-empty branch.
 */
const optionalTrimmedText = z
  .union([
    z.literal("").transform(() => undefined),
    z.string().trim().min(1).max(500, "Notes cannot exceed 500 characters."),
  ])
  .optional();

const dateRangeRefine = <T extends { started_at?: string; ended_at?: string }>(
  data: T,
  ctx: z.RefinementCtx,
) => {
  if (data.started_at && data.ended_at) {
    if (Date.parse(data.ended_at) < Date.parse(data.started_at)) {
      ctx.addIssue({
        code: "custom",
        path: ["ended_at"],
        message: "End date must be on or after start date.",
      });
    }
  }
};

/**
 * Body accepted by `createAssignmentAction` — one unified form, routed
 * server-side to the correct DB table based on `role`.
 */
export const createAssignmentSchema = z
  .object({
    project_id: uuidSchema,
    employee_id: uuidSchema,
    role: assignmentRoleSchema,
    allocation_percentage: z
      .number()
      .int("Allocation must be a whole number.")
      .min(1, "Allocation must be at least 1%.")
      .max(100, "Allocation cannot exceed 100%."),
    started_at: isoDateSchema,
    ended_at: isoDateSchema.optional(),
    notes: optionalTrimmedText,
  })
  .superRefine((data, ctx) => {
    dateRangeRefine(data, ctx);

    // PM assignments implicitly own the project — allocation must be 100.
    // This matches the mental model of a PRIMARY_PM/CO_PM being fully
    // engaged on the project. Non-PM members can be partial.
    if (assignmentKindFromRole(data.role) === "pm" && data.allocation_percentage !== 100) {
      ctx.addIssue({
        code: "custom",
        path: ["allocation_percentage"],
        message: "PM assignments require 100% allocation.",
      });
    }
  });

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

/**
 * Body accepted by `updateAssignmentAction`. `role` cannot be changed —
 * users must end the old row and create a new one so the audit trail is
 * unambiguous.
 */
export const updateAssignmentSchema = z
  .object({
    id: uuidSchema,
    kind: z.enum(["pm", "member"]),
    allocation_percentage: z
      .number()
      .int("Allocation must be a whole number.")
      .min(1, "Allocation must be at least 1%.")
      .max(100, "Allocation cannot exceed 100%.")
      .optional(),
    started_at: isoDateSchema.optional(),
    ended_at: isoDateSchema.optional(),
    notes: optionalTrimmedText,
  })
  .superRefine((data, ctx) => {
    dateRangeRefine(data, ctx);
    if (data.kind === "pm" && data.allocation_percentage !== undefined && data.allocation_percentage !== 100) {
      ctx.addIssue({
        code: "custom",
        path: ["allocation_percentage"],
        message: "PM assignments require 100% allocation.",
      });
    }
  });

export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

/**
 * Body accepted by `endAssignmentAction` — flips status to ENDED and
 * records `ended_at` (defaults to today).
 */
export const endAssignmentSchema = z.object({
  id: uuidSchema,
  kind: z.enum(["pm", "member"]),
  ended_at: isoDateSchema.optional(),
});

export type EndAssignmentInput = z.infer<typeof endAssignmentSchema>;

// ---------------------------------------------------------------------------
// Trigger-error parsing. The DB trigger `check_employee_allocation_capacity`
// raises exceptions in the format
//    `ALLOCATION_OVER_CAP:<uuid>:<current>:<new>`
// (see 0043_assignments_role_and_notes.sql). Actions call this helper to
// convert raw PostgREST errors into friendly `ActionResult` reasons.
// ---------------------------------------------------------------------------

export type AllocationOverCap = {
  employeeId: string;
  currentTotalPct: number;
  requestedPct: number;
};

const OVER_CAP_RE = /ALLOCATION_OVER_CAP:([0-9a-f-]{36}):(\d+):(\d+)/i;

export function parseAllocationOverCap(message: string | null | undefined): AllocationOverCap | null {
  if (!message) return null;
  const m = message.match(OVER_CAP_RE);
  if (!m) return null;
  return {
    employeeId: m[1],
    currentTotalPct: Number(m[2]),
    requestedPct: Number(m[3]),
  };
}
