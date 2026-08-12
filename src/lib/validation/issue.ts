/**
 * ControlDesk — Project Issue Zod schemas (Fase 2, rules §26).
 *
 * Aligned with:
 *   supabase/migrations/0029_project_issues.sql
 *   src/lib/issues/state.ts
 */

import { z } from "zod";

import { isoDateSchema, longText, shortText, uuidSchema } from "./common";
import type {
  ProjectIssueCategory,
  ProjectIssueSeverity,
  ProjectIssueStatus,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Primitive enums. We keep the literal tuples inline so the resulting Zod
// enums narrow to the same string-literal union as the DB-generated types.
// ---------------------------------------------------------------------------

export const ISSUE_SEVERITY_VALUES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const satisfies readonly ProjectIssueSeverity[];

export const ISSUE_CATEGORY_VALUES = [
  "BUG",
  "FEATURE",
  "TASK",
  "INCIDENT",
  "RISK",
  "IMPROVEMENT",
  "QUESTION",
] as const satisfies readonly ProjectIssueCategory[];

export const issueCategorySchema = z.enum(ISSUE_CATEGORY_VALUES);
export type IssueCategoryInput = z.infer<typeof issueCategorySchema>;

/**
 * Free-form tag validator.
 *
 * Constraints (rules §26):
 *   * ≤ 20 tags per issue — keeps GIN index cheap and prevents runaway UI.
 *   * Each tag ≤ 50 chars, lowercase preferred (we lower-case here).
 *   * Deduplicated post-normalisation.
 */
const tagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(20, "Maksimum 20 tag per issue.")
  .transform((arr) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of arr) {
      const cleaned = raw.trim().toLowerCase();
      if (!cleaned) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      out.push(cleaned);
    }
    return out;
  })
  .optional()
  .transform((v) => v ?? []);

export const ISSUE_STATUS_VALUES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
] as const satisfies readonly ProjectIssueStatus[];

export const issueSeveritySchema = z.enum(ISSUE_SEVERITY_VALUES);
export type IssueSeverityInput = z.infer<typeof issueSeveritySchema>;

export const issueStatusSchema = z.enum(ISSUE_STATUS_VALUES);
export type IssueStatusInput = z.infer<typeof issueStatusSchema>;

/**
 * Transitions accept a smaller subset — REOPENED is entered from CLOSED or
 * RESOLVED and is bounced back into IN_PROGRESS by a follow-up transition,
 * so we allow the full range and rely on `canTransitionIssue()` at the
 * Server-Action layer for the graph guard.
 */
export const transitionStatusSchema = issueStatusSchema;

// ---------------------------------------------------------------------------
// Payloads.
// ---------------------------------------------------------------------------

const notesFieldSchema = z
  .string()
  .trim()
  .max(2000, "Notes maksimum 2000 karakter.")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const createIssueSchema = z.object({
  project_id: uuidSchema,
  title: shortText,
  description: z
    .string()
    .trim()
    .max(4000, "Deskripsi maksimum 4000 karakter.")
    .default(""),
  severity: issueSeveritySchema.default("MEDIUM"),
  category: issueCategorySchema.default("BUG"),
  /** Optional initial assignee — defaults to project's Supervisor if unset. */
  assignee_employee_id: uuidSchema.optional(),
  /** Optional link into project_milestones (same project). */
  milestone_id: uuidSchema.optional(),
  /** Optional manual target completion date (distinct from sla_due_at). */
  due_date: isoDateSchema.optional(),
  tags: tagsSchema,
  /** Internal remarks not shown to customers / clients. */
  notes: notesFieldSchema,
});
export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = z
  .object({
    issue_id: uuidSchema,
    title: shortText.optional(),
    description: z
      .string()
      .trim()
      .max(4000, "Deskripsi maksimum 4000 karakter.")
      .optional(),
    severity: issueSeveritySchema.optional(),
    category: issueCategorySchema.optional(),
    assignee_employee_id: uuidSchema.nullable().optional(),
    milestone_id: uuidSchema.nullable().optional(),
    due_date: isoDateSchema.nullable().optional(),
    tags: tagsSchema.optional(),
    notes: notesFieldSchema,
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.severity !== undefined ||
      v.category !== undefined ||
      v.assignee_employee_id !== undefined ||
      v.milestone_id !== undefined ||
      v.due_date !== undefined ||
      v.tags !== undefined ||
      v.notes !== undefined,
    { message: "At least one field must be provided to update." },
  );
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

export const transitionIssueSchema = z.object({
  issue_id: uuidSchema,
  to_status: transitionStatusSchema,
  comment: z
    .string()
    .trim()
    .max(2000, "Komentar maksimum 2000 karakter.")
    .optional(),
});
export type TransitionIssueInput = z.infer<typeof transitionIssueSchema>;

export const commentIssueSchema = z.object({
  issue_id: uuidSchema,
  comment: longText.max(2000, "Komentar maksimum 2000 karakter."),
});
export type CommentIssueInput = z.infer<typeof commentIssueSchema>;

export const assignIssueSchema = z.object({
  issue_id: uuidSchema,
  assignee_employee_id: uuidSchema.nullable(),
});
export type AssignIssueInput = z.infer<typeof assignIssueSchema>;

export const closeIssueSchema = z.object({
  issue_id: uuidSchema,
  comment: z
    .string()
    .trim()
    .max(2000, "Komentar maksimum 2000 karakter.")
    .optional(),
});
export type CloseIssueInput = z.infer<typeof closeIssueSchema>;
