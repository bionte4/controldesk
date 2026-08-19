/**
 * ControlDesk — Zod schemas for the tenant Knowledge Base (KB).
 *
 * These are the single source of truth for input validation on every
 * Server Action in `src/app/(app)/knowledge/actions.ts`. The shape and
 * upper-bounds must stay in lockstep with the DB CHECK constraints
 * defined in migration 0095_knowledge_articles.sql — if you loosen a
 * schema here, tighten the DB check first (or you'll silently ship a
 * bypass).
 *
 * Naming:
 *   • `xxxSchema`  — the Zod object (use with `.safeParse`)
 *   • `XxxInput`   — the inferred type (use as the Server Action's arg)
 */

import { z } from "zod";

import { CANONICAL_ROLES, EMPLOYEE_ROLES } from "@/lib/rbac/roles";

/**
 * Category taxonomy. First seven values MATCH the repo-authored
 * `HELP_CATEGORY_ORDER` constant in `src/lib/help/categories.ts` so
 * the /help browse UI can present static articles and tenant articles
 * under the same sections. The last three (`internal-sop`,
 * `meeting-notes`, `decisions`) are KB-only — they don't exist in the
 * static manifest and never leak to the public /help route.
 *
 * DB parity: keep this list in sync with the CHECK constraint on
 * `knowledge_articles.category` in migration 0095.
 */
export const KNOWLEDGE_ARTICLE_CATEGORIES = [
  "getting-started",
  "user-guides",
  "approvals",
  "finance",
  "hr",
  "integrations",
  "reference",
  "internal-sop",
  "meeting-notes",
  "decisions",
] as const;
export type KnowledgeArticleCategory =
  (typeof KNOWLEDGE_ARTICLE_CATEGORIES)[number];

export const KNOWLEDGE_ARTICLE_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
] as const;
export type KnowledgeArticleStatus =
  (typeof KNOWLEDGE_ARTICLE_STATUSES)[number];

export const KNOWLEDGE_ARTICLE_VISIBILITIES = [
  "TENANT_WIDE",
  // Reserved for Fase 2 — accepted at the DB but rejected at the
  // Server Action layer until the visibility engine is wired. See
  // `visibilitySchema` below.
  "ROLE_GATED",
  "PROJECT_SCOPED",
] as const;
export type KnowledgeArticleVisibility =
  (typeof KNOWLEDGE_ARTICLE_VISIBILITIES)[number];

// ---------------------------------------------------------------------------
// Primitive builders — shared across the create / update schemas.
// ---------------------------------------------------------------------------

/**
 * URL-safe slug. Lower-case letters, digits, and hyphens only. No
 * leading/trailing hyphen, no consecutive hyphens. Cap at 80 chars
 * so the /knowledge/{slug} URL stays comfortably under browser
 * limits when appended to a tenant subdomain.
 *
 * We DELIBERATELY don't auto-generate the slug from the title in this
 * schema — that's the UI layer's job (client-side preview so the
 * author can override before submitting). A well-typed schema makes
 * accidental server-side generation ("what does slug default to?")
 * impossible.
 */
const slug = z
  .string()
  .trim()
  .min(3, "Slug must be at least 3 characters.")
  .max(80, "Slug must be at most 80 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lower-case letters, digits, and single hyphens (no leading/trailing hyphen).",
  );

const title = z
  .string()
  .trim()
  .min(3, "Title must be at least 3 characters.")
  .max(200, "Title must be at most 200 characters.");

/**
 * Summary is optional but the UI encourages it on publish (see the
 * publish schema below, which upgrades to `required`). We accept an
 * empty string here so the "save draft" flow can round-trip a blank
 * summary without a validation error; normalized to `null` before
 * persistence in the data layer.
 */
const summary = z
  .string()
  .trim()
  .max(400, "Summary must be at most 400 characters.")
  .optional();

/**
 * Markdown body. Upper bound (100k chars ≈ 40 pages of prose) matches
 * the DB CHECK constraint. Lower bound is `1` — a one-line article
 * is legal (e.g., "Deprecated — see [X]."). The Server Action will
 * additionally reject bodies that are pure whitespace after trim.
 */
const bodyMd = z
  .string()
  .min(1, "Body cannot be empty.")
  .max(100_000, "Body must be at most 100 000 characters (≈ 40 pages).");

const category = z.enum(KNOWLEDGE_ARTICLE_CATEGORIES, {
  message: "Choose a valid category.",
});

/**
 * Visibility. Phase 2c widens this from the v1 hard-lock to
 * `TENANT_WIDE` to the full three-way enum. Side fields
 * (`visibility_roles`, `visibility_project_id`) live below and are
 * cross-validated with `superRefine` on each of the schemas that
 * accept them — that's where the "ROLE_GATED needs at least one
 * role" and "PROJECT_SCOPED needs a project id" invariants are
 * enforced, mirroring the DB CHECK constraint in migration 0098.
 */
const visibility = z.enum(KNOWLEDGE_ARTICLE_VISIBILITIES, {
  message: "Choose a valid visibility mode.",
});

/**
 * `visibility_roles` — array of role strings. Accepts BOTH legacy DB
 * names (`TENANT_ADMIN`, `HEAD_MANAGER`, …) and canonical GAS names
 * (`ADMIN`, `DIRECTOR`, …) via the union of `EMPLOYEE_ROLES` and
 * `CANONICAL_ROLES`. `resolveVisibilityFilter()` in the data layer
 * uses `roleInGate()` to match legacy ↔ canonical so a role can be
 * declared in either dialect and still match the caller.
 *
 * Empty array is the "unset" signal; the cross-field refine in each
 * schema requires ≥1 entry only when visibility is `ROLE_GATED`.
 */
const visibilityRoles = z
  .array(z.enum([...EMPLOYEE_ROLES, ...CANONICAL_ROLES] as [string, ...string[]]))
  .max(20, "At most 20 roles per article.")
  .default([]);

/**
 * `visibility_project_id` — UUID of a project row. Nullable so
 * TENANT_WIDE / ROLE_GATED can clear it. Refine requires a value
 * when visibility is `PROJECT_SCOPED`.
 */
const visibilityProjectId = z
  .string()
  .uuid("Invalid project id.")
  .nullable()
  .optional();

const editNote = z
  .string()
  .trim()
  .max(500, "Edit note must be at most 500 characters.")
  .optional();

// ---------------------------------------------------------------------------
// Create.
// ---------------------------------------------------------------------------

/**
 * Cross-field refine for visibility side fields. Kept in a helper
 * because both create and update need identical semantics, and
 * inlining it twice invites drift.
 *
 * Rules mirror the DB CHECK constraint added in migration 0098:
 *   ROLE_GATED     ⇒ `visibility_roles.length >= 1`
 *   PROJECT_SCOPED ⇒ `visibility_project_id` non-null
 *   TENANT_WIDE    ⇒ side fields ignored (may be non-empty; the
 *                    data layer treats them as unset)
 */
function refineVisibilitySideFields(
  data: {
    visibility?: KnowledgeArticleVisibility;
    visibility_roles?: readonly string[] | undefined;
    visibility_project_id?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const v = data.visibility;
  if (!v) return; // Field is optional on updates; skip when omitted.
  if (v === "ROLE_GATED") {
    if (!data.visibility_roles || data.visibility_roles.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["visibility_roles"],
        message: "Select at least one role for role-gated visibility.",
      });
    }
  } else if (v === "PROJECT_SCOPED") {
    if (!data.visibility_project_id) {
      ctx.addIssue({
        code: "custom",
        path: ["visibility_project_id"],
        message: "Select a project for project-scoped visibility.",
      });
    }
  }
}

/**
 * Create a new article — always starts in DRAFT. The author does NOT
 * pass status; use `publishKnowledgeArticleSchema` for the DRAFT →
 * PUBLISHED transition.
 */
export const createKnowledgeArticleSchema = z
  .object({
    slug,
    title,
    summary,
    body_md: bodyMd,
    category,
    visibility: visibility.default("TENANT_WIDE"),
    visibility_roles: visibilityRoles,
    visibility_project_id: visibilityProjectId,
    edit_note: editNote,
  })
  .superRefine(refineVisibilitySideFields);
export type CreateKnowledgeArticleInput = z.infer<
  typeof createKnowledgeArticleSchema
>;

// ---------------------------------------------------------------------------
// Update.
// ---------------------------------------------------------------------------

/**
 * Edit an existing article without changing its lifecycle state.
 * All content fields are optional so the UI can send only the changed
 * fields; the Server Action merges with the current row before
 * persisting.
 *
 * Note: `slug` IS included and IS mutable. Renaming a slug creates a
 * redirect obligation — the data layer records the old slug in the
 * revision row so a future redirect map can be built by scanning the
 * revisions table.
 */
export const updateKnowledgeArticleSchema = z
  .object({
    id: z.string().uuid("Invalid article id."),
    slug: slug.optional(),
    title: title.optional(),
    summary,
    body_md: bodyMd.optional(),
    category: category.optional(),
    visibility: visibility.optional(),
    // Side fields default to empty array / null so an update that
    // ONLY toggles the visibility enum still passes `superRefine`
    // — the check runs against the merged shape.
    visibility_roles: visibilityRoles.optional(),
    visibility_project_id: visibilityProjectId,
    edit_note: editNote,
  })
  .superRefine(refineVisibilitySideFields);
export type UpdateKnowledgeArticleInput = z.infer<
  typeof updateKnowledgeArticleSchema
>;

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

/**
 * Publish a DRAFT (or re-publish an ARCHIVED article). The `summary`
 * upgrade to required happens here because a published article
 * without a summary hurts the /help browse UX and chatbot citation
 * blurb.
 */
export const publishKnowledgeArticleSchema = z.object({
  id: z.string().uuid("Invalid article id."),
  summary: z
    .string()
    .trim()
    .min(10, "Provide a summary of at least 10 characters before publishing.")
    .max(400, "Summary must be at most 400 characters."),
  edit_note: editNote,
});
export type PublishKnowledgeArticleInput = z.infer<
  typeof publishKnowledgeArticleSchema
>;

export const archiveKnowledgeArticleSchema = z.object({
  id: z.string().uuid("Invalid article id."),
  edit_note: editNote,
});
export type ArchiveKnowledgeArticleInput = z.infer<
  typeof archiveKnowledgeArticleSchema
>;

/** Return an archived article to DRAFT so the author can edit + republish. */
export const restoreKnowledgeArticleSchema = z.object({
  id: z.string().uuid("Invalid article id."),
  edit_note: editNote,
});
export type RestoreKnowledgeArticleInput = z.infer<
  typeof restoreKnowledgeArticleSchema
>;
