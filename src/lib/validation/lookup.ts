/**
 * ControlDesk — Zod schemas for `lookup_options` admin CRUD.
 *
 * Backs the server actions in
 * `src/app/(app)/settings/lookups/actions.ts`. Mirrors the DB CHECK
 * constraint in migration 0049.
 */

import { z } from "zod";

import { uuidSchema } from "./common";

// ---------------------------------------------------------------------------
// Domain enum — MUST stay in sync with:
//   - migration 0049 CHECK constraint on `lookup_options.domain`
//   - `LOOKUP_DOMAINS` in `src/lib/data/lookups.ts`
// ---------------------------------------------------------------------------

export const LOOKUP_DOMAIN_VALUES = [
  "unit_pengaju",
  "transport_need",
  "area",
  "rab_category",
] as const;

export const lookupDomainSchema = z.enum(LOOKUP_DOMAIN_VALUES);
export type LookupDomainInput = z.infer<typeof lookupDomainSchema>;

// ---------------------------------------------------------------------------
// Field validators.
// ---------------------------------------------------------------------------

/**
 * Stable machine identifier. Uppercase letters + digits + `-` + `_` only.
 * Kept short so tables and joins stay readable.
 */
const codeSchema = z
  .string()
  .trim()
  .min(1, "Code is required.")
  .max(48, "Code too long.")
  .regex(
    /^[A-Z0-9][A-Z0-9_-]*$/u,
    "Use uppercase letters, digits, hyphen, or underscore (e.g. NOC-JKT).",
  );

const labelSchema = z
  .string()
  .trim()
  .min(1, "Label is required.")
  .max(120, "Label too long.");

const descriptionSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v));

const sortOrderSchema = z
  .number({ message: "Sort order must be a number." })
  .int("Sort order must be a whole number.")
  .min(0)
  .max(9999)
  .optional();

// ---------------------------------------------------------------------------
// CREATE — admin adds a new option in a domain.
// ---------------------------------------------------------------------------

export const createLookupOptionSchema = z.object({
  domain: lookupDomainSchema,
  code: codeSchema,
  label: labelSchema,
  description: descriptionSchema,
  sort_order: sortOrderSchema,
  is_active: z.boolean().optional().default(true),
});
export type CreateLookupOptionInput = z.infer<typeof createLookupOptionSchema>;

// ---------------------------------------------------------------------------
// UPDATE — admin edits an existing option. `domain` is immutable (a
// migration path would be to deactivate + re-create in the new domain);
// `code` can be relabelled but rarely should be.
// ---------------------------------------------------------------------------

export const updateLookupOptionSchema = z.object({
  id: uuidSchema,
  code: codeSchema,
  label: labelSchema,
  description: descriptionSchema,
  sort_order: sortOrderSchema,
  is_active: z.boolean().optional(),
});
export type UpdateLookupOptionInput = z.infer<typeof updateLookupOptionSchema>;

// ---------------------------------------------------------------------------
// TOGGLE ACTIVE — soft delete / restore. Preferred over hard delete so
// historical rows referencing the label snapshot stay traceable.
// ---------------------------------------------------------------------------

export const toggleLookupOptionActiveSchema = z.object({
  id: uuidSchema,
  is_active: z.boolean(),
});
export type ToggleLookupOptionActiveInput = z.infer<
  typeof toggleLookupOptionActiveSchema
>;

// ---------------------------------------------------------------------------
// DELETE (hard) — rarely used; only for typo removals before rows exist
// downstream. Actions can decide whether to allow it based on
// downstream usage lookups.
// ---------------------------------------------------------------------------

export const deleteLookupOptionSchema = z.object({
  id: uuidSchema,
});
export type DeleteLookupOptionInput = z.infer<
  typeof deleteLookupOptionSchema
>;
