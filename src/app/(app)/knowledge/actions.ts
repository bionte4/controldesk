"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import {
  appendKnowledgeArticleRevision,
  loadKnowledgeArticleById,
} from "@/lib/data/knowledge-articles";
import {
  dropKnowledgeArticleEmbeddings,
  reindexKnowledgeArticle,
} from "@/lib/help/knowledge-embeddings";
import { log } from "@/lib/observability/log";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import {
  archiveKnowledgeArticleSchema,
  createKnowledgeArticleSchema,
  publishKnowledgeArticleSchema,
  restoreKnowledgeArticleSchema,
  updateKnowledgeArticleSchema,
  type CreateKnowledgeArticleInput,
  type UpdateKnowledgeArticleInput,
} from "@/lib/validation/knowledge-article";

/**
 * Server Actions for the tenant Knowledge Base (Fase 1 — Tier 1 KB).
 *
 * All mutations go through `withSecureAction` (rules §17.2 + §17.3):
 *   1. Session gate (`requireCurrentEmployee` inside the wrapper).
 *   2. Zod validation against the input schema.
 *   3. PDP check via the legacy `authorize()` — the KB is modelled
 *      on `resource: "knowledge_article"` (see decideKnowledgeArticle
 *      in `src/lib/security/pdp.ts`).
 *   4. Handler runs.
 *   5. Audit row written with old/new snapshot.
 *
 * Verb mapping between the action wrapper and the KB domain:
 *
 *   ┌──────────────────────────┬─────────────┬────────────────┐
 *   │ Server Action            │ PDP verb    │ Audit action   │
 *   ├──────────────────────────┼─────────────┼────────────────┤
 *   │ createKnowledgeArticle   │ create      │ CREATE         │
 *   │ updateKnowledgeArticle   │ update      │ UPDATE         │
 *   │ publishKnowledgeArticle  │ submit      │ UPDATE         │
 *   │ archiveKnowledgeArticle  │ cancel      │ UPDATE         │
 *   │ restoreKnowledgeArticle  │ update      │ UPDATE         │
 *   └──────────────────────────┴─────────────┴────────────────┘
 *
 * `submit` is used for "publish" and `cancel` is used for "archive"
 * because the `audit_action_type` enum doesn't have dedicated
 * PUBLISH/ARCHIVE values (migration 0009 defined the enum before KB
 * existed). Adding them is a one-line follow-up migration — but the
 * publish/archive metadata is already captured in `auditNewValues`,
 * so downstream analytics can distinguish the state transitions
 * without a schema change.
 */

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Extract the persistence-shape snapshot used by both the audit row
 * and the `knowledge_article_revisions` insert. Keeps the two copies
 * in lock-step so we don't have to grep both call sites when a new
 * column lands.
 */
function toSnapshot(row: {
  title: string;
  summary: string | null;
  body_md: string;
  category: string;
  status: string;
  visibility: string;
  visibility_roles: string[] | null;
  visibility_project_id: string | null;
}) {
  return {
    title: row.title,
    summary: row.summary,
    body_md: row.body_md,
    category: row.category as never,
    status: row.status as never,
    visibility: row.visibility as never,
    visibility_roles: row.visibility_roles ?? [],
    visibility_project_id: row.visibility_project_id,
  };
}

// ---------------------------------------------------------------------------
// Create.
// ---------------------------------------------------------------------------

export const createKnowledgeArticleAction = withSecureAction({
  schema: createKnowledgeArticleSchema,
  resource: "knowledge_article",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "knowledge_articles",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    ownerEmployeeId: ctx.actor.employeeId,
  }),
  handler: async (input: CreateKnowledgeArticleInput, ctx) => {
    const supabase = await createClient();

    // Normalize side fields against the chosen visibility mode so
    // the DB CHECK constraint (migration 0098) always passes and
    // stale values from an aborted mode switch never linger.
    const normalizedRoles =
      input.visibility === "ROLE_GATED" ? (input.visibility_roles ?? []) : [];
    const normalizedProjectId =
      input.visibility === "PROJECT_SCOPED"
        ? (input.visibility_project_id ?? null)
        : null;

    const { data, error } = await supabase
      .from("knowledge_articles")
      .insert({
        tenant_id: ctx.actor.tenantId,
        author_employee_id: ctx.actor.employeeId,
        slug: input.slug,
        title: input.title,
        summary: input.summary ?? null,
        body_md: input.body_md,
        category: input.category,
        visibility: input.visibility,
        visibility_roles: normalizedRoles,
        visibility_project_id: normalizedProjectId,
        status: "DRAFT",
      })
      .select(
        "id, slug, title, summary, body_md, category, status, visibility, visibility_roles, visibility_project_id",
      )
      .single();

    if (error || !data) {
      // Postgres unique_violation on `(tenant_id, slug)` — friendlier
      // error surface than the raw `23505` code.
      if (error?.code === "23505") {
        throw new Error(`Slug "${input.slug}" is already used in this workspace.`);
      }
      throw new Error(error?.message ?? "Failed to create article.");
    }

    // First revision — audit trail starts at #1 with the initial
    // content. Failing here rolls back the client's action but
    // leaves the article row present (revisions are diagnostic, not
    // correctness); admin can trigger a manual reindex if needed.
    try {
      await appendKnowledgeArticleRevision({
        articleId: data.id,
        snapshot: toSnapshot(data),
        edit_note: input.edit_note ?? "Initial draft",
      });
    } catch (err) {
      log.warn("knowledge_article_initial_revision_failed", {
        tenant_id: ctx.actor.tenantId,
        article_id: data.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    revalidatePath("/knowledge");

    return {
      result: { id: data.id, slug: data.slug },
      auditResourceId: data.id,
      auditNewValues: {
        slug: data.slug,
        title: data.title,
        category: data.category,
        status: data.status,
        visibility: data.visibility,
        visibility_roles: data.visibility_roles,
        visibility_project_id: data.visibility_project_id,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Update (in-place content edit — no lifecycle transition).
// ---------------------------------------------------------------------------

export const updateKnowledgeArticleAction = withSecureAction({
  schema: updateKnowledgeArticleSchema,
  resource: "knowledge_article",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "knowledge_articles",
  resolveAttributes: async (input, ctx) => {
    // Load the current row so `ownerEmployeeId` can be plugged into
    // the PDP attributes. If the row is missing (or hidden by RLS),
    // report ownership as "unknown" so the PDP treats the caller as
    // non-author and denies — matches the RLS UPDATE policy which
    // would also block the write.
    const current = await loadKnowledgeArticleById(input.id);
    return {
      tenantId: ctx.actor.tenantId,
      ownerEmployeeId: current?.author_employee_id,
    };
  },
  handler: async (input: UpdateKnowledgeArticleInput, ctx) => {
    const supabase = await createClient();

    const current = await loadKnowledgeArticleById(input.id);
    if (!current) {
      throw new Error("Article not found.");
    }

    const patch: TablesUpdate<"knowledge_articles"> = {};
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.title !== undefined) patch.title = input.title;
    if (input.summary !== undefined) {
      patch.summary = input.summary.length > 0 ? input.summary : null;
    }
    if (input.body_md !== undefined) patch.body_md = input.body_md;
    if (input.category !== undefined) patch.category = input.category;

    // Visibility patching — three-way normalize. The DB CHECK
    // constraint (0098) forbids "ROLE_GATED with empty roles" and
    // "PROJECT_SCOPED with null project_id", so whenever visibility
    // changes we recompute the side fields against the NEW mode.
    // When visibility is unchanged, we only touch a side field if
    // the input explicitly set it.
    if (input.visibility !== undefined) {
      const roles =
        input.visibility === "ROLE_GATED"
          ? (input.visibility_roles ?? current.visibility_roles ?? [])
          : [];
      const projectId =
        input.visibility === "PROJECT_SCOPED"
          ? (input.visibility_project_id !== undefined
              ? input.visibility_project_id
              : current.visibility_project_id) ?? null
          : null;
      patch.visibility = input.visibility;
      patch.visibility_roles = roles;
      patch.visibility_project_id = projectId;
    } else {
      // Visibility unchanged — side fields must still respect the
      // current mode. Ignore side-field input for a mode that
      // doesn't consume it (defense against a client that leaks
      // stale form state).
      if (
        input.visibility_roles !== undefined &&
        current.visibility === "ROLE_GATED"
      ) {
        patch.visibility_roles = input.visibility_roles;
      }
      if (
        input.visibility_project_id !== undefined &&
        current.visibility === "PROJECT_SCOPED"
      ) {
        patch.visibility_project_id = input.visibility_project_id ?? null;
      }
    }

    // Nothing changed — no-op. Skipping the write avoids an empty
    // revision row + a noisy audit entry.
    if (Object.keys(patch).length === 0) {
      return {
        result: { id: current.id, slug: current.slug },
        auditResourceId: current.id,
        auditOldValues: null,
        auditNewValues: null,
      };
    }

    const { data, error } = await supabase
      .from("knowledge_articles")
      .update(patch)
      .eq("id", input.id)
      .select(
        "id, slug, title, summary, body_md, category, status, visibility, visibility_roles, visibility_project_id",
      )
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new Error(`Slug "${input.slug}" is already used in this workspace.`);
      }
      throw new Error(error?.message ?? "Failed to update article.");
    }

    try {
      await appendKnowledgeArticleRevision({
        articleId: data.id,
        snapshot: toSnapshot(data),
        edit_note: input.edit_note ?? null,
      });
    } catch (err) {
      log.warn("knowledge_article_revision_failed", {
        tenant_id: ctx.actor.tenantId,
        article_id: data.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    revalidatePath("/knowledge");
    revalidatePath(`/knowledge/${data.slug}`);
    if (data.slug !== current.slug) {
      // Old slug is now a 404 — force the router to drop its cached
      // copy. A redirect map is planned for Fase 2 (see the data
      // module note on revisions).
      revalidatePath(`/knowledge/${current.slug}`);
    }

    // Only PUBLISHED articles carry embeddings; skip the reindex
    // otherwise. `reindexKnowledgeArticle` itself will short-circuit
    // for non-published rows, but skipping the call here saves a
    // service-role round-trip on every draft save.
    if (data.status === "PUBLISHED") {
      after(async () => {
        try {
          await reindexKnowledgeArticle(data.id);
        } catch (err) {
          log.warn("knowledge_update_reindex_failed", {
            tenant_id: ctx.actor.tenantId,
            article_id: data.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    return {
      result: { id: data.id, slug: data.slug },
      auditResourceId: data.id,
      auditOldValues: {
        slug: current.slug,
        title: current.title,
        category: current.category,
        summary: current.summary,
        visibility: current.visibility,
        visibility_roles: current.visibility_roles,
        visibility_project_id: current.visibility_project_id,
      },
      auditNewValues: {
        slug: data.slug,
        title: data.title,
        category: data.category,
        summary: data.summary,
        visibility: data.visibility,
        visibility_roles: data.visibility_roles,
        visibility_project_id: data.visibility_project_id,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Publish (DRAFT | ARCHIVED → PUBLISHED).
// ---------------------------------------------------------------------------

export const publishKnowledgeArticleAction = withSecureAction({
  schema: publishKnowledgeArticleSchema,
  resource: "knowledge_article",
  action: "submit",
  auditAction: "UPDATE",
  auditResourceName: "knowledge_articles",
  resolveAttributes: async (input, ctx) => {
    const current = await loadKnowledgeArticleById(input.id);
    return {
      tenantId: ctx.actor.tenantId,
      ownerEmployeeId: current?.author_employee_id,
      status: current?.status,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const current = await loadKnowledgeArticleById(input.id);
    if (!current) throw new Error("Article not found.");

    if (current.status === "PUBLISHED") {
      throw new Error("Article is already published.");
    }

    const { data, error } = await supabase
      .from("knowledge_articles")
      .update({
        status: "PUBLISHED",
        summary: input.summary,
        published_at: new Date().toISOString(),
        archived_at: null,
      })
      .eq("id", input.id)
      .select(
        "id, slug, title, summary, body_md, category, status, visibility, visibility_roles, visibility_project_id, published_at",
      )
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to publish article.");
    }

    try {
      await appendKnowledgeArticleRevision({
        articleId: data.id,
        snapshot: toSnapshot(data),
        edit_note: input.edit_note ?? "Published",
      });
    } catch (err) {
      log.warn("knowledge_article_publish_revision_failed", {
        tenant_id: ctx.actor.tenantId,
        article_id: data.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    revalidatePath("/knowledge");
    revalidatePath(`/knowledge/${data.slug}`);

    // Fire-and-forget reindex — runs after the response has flushed
    // to the client so the publish button feels instantaneous. If
    // the embedding call fails, the article is still published; the
    // backfill script (`pnpm knowledge:reindex`) can pick it up later.
    after(async () => {
      try {
        await reindexKnowledgeArticle(data.id);
      } catch (err) {
        log.warn("knowledge_publish_reindex_failed", {
          tenant_id: ctx.actor.tenantId,
          article_id: data.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return {
      result: { id: data.id, slug: data.slug, published_at: data.published_at },
      auditResourceId: data.id,
      auditOldValues: { status: current.status },
      auditNewValues: {
        status: "PUBLISHED",
        published_at: data.published_at,
        transition: "PUBLISH",
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Archive (PUBLISHED | DRAFT → ARCHIVED).
// ---------------------------------------------------------------------------

export const archiveKnowledgeArticleAction = withSecureAction({
  schema: archiveKnowledgeArticleSchema,
  resource: "knowledge_article",
  action: "cancel",
  auditAction: "UPDATE",
  auditResourceName: "knowledge_articles",
  resolveAttributes: async (input, ctx) => {
    const current = await loadKnowledgeArticleById(input.id);
    return {
      tenantId: ctx.actor.tenantId,
      ownerEmployeeId: current?.author_employee_id,
      status: current?.status,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const current = await loadKnowledgeArticleById(input.id);
    if (!current) throw new Error("Article not found.");
    if (current.status === "ARCHIVED") {
      throw new Error("Article is already archived.");
    }

    const { data, error } = await supabase
      .from("knowledge_articles")
      .update({
        status: "ARCHIVED",
        archived_at: new Date().toISOString(),
        // Clearing `published_at` keeps the CHECK constraint happy
        // (see migration 0095: PUBLISHED requires published_at,
        // ARCHIVED requires only archived_at).
        published_at: null,
      })
      .eq("id", input.id)
      .select(
        "id, slug, title, summary, body_md, category, status, visibility, visibility_roles, visibility_project_id, archived_at",
      )
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to archive article.");
    }

    try {
      await appendKnowledgeArticleRevision({
        articleId: data.id,
        snapshot: toSnapshot(data),
        edit_note: input.edit_note ?? "Archived",
      });
    } catch (err) {
      log.warn("knowledge_article_archive_revision_failed", {
        tenant_id: ctx.actor.tenantId,
        article_id: data.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    revalidatePath("/knowledge");
    revalidatePath(`/knowledge/${data.slug}`);

    // Clear the RAG index so archived content stops surfacing in
    // chatbot answers. Best-effort — a failed drop leaves stale
    // embeddings, which the reindex script will overwrite next
    // time the article is republished (or the next full pass).
    after(async () => {
      try {
        await dropKnowledgeArticleEmbeddings(data.id);
      } catch (err) {
        log.warn("knowledge_archive_drop_embeddings_failed", {
          tenant_id: ctx.actor.tenantId,
          article_id: data.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return {
      result: { id: data.id, slug: data.slug, archived_at: data.archived_at },
      auditResourceId: data.id,
      auditOldValues: { status: current.status },
      auditNewValues: {
        status: "ARCHIVED",
        archived_at: data.archived_at,
        transition: "ARCHIVE",
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Restore (ARCHIVED → DRAFT). Editing an archived article requires
// bringing it back to draft first so the CHECK constraint doesn't
// complain about `archived_at` on a mutable row.
// ---------------------------------------------------------------------------

export const restoreKnowledgeArticleAction = withSecureAction({
  schema: restoreKnowledgeArticleSchema,
  resource: "knowledge_article",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "knowledge_articles",
  resolveAttributes: async (input, ctx) => {
    const current = await loadKnowledgeArticleById(input.id);
    return {
      tenantId: ctx.actor.tenantId,
      ownerEmployeeId: current?.author_employee_id,
      status: current?.status,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const current = await loadKnowledgeArticleById(input.id);
    if (!current) throw new Error("Article not found.");
    if (current.status !== "ARCHIVED") {
      throw new Error("Only archived articles can be restored to draft.");
    }

    const { data, error } = await supabase
      .from("knowledge_articles")
      .update({
        status: "DRAFT",
        archived_at: null,
        published_at: null,
      })
      .eq("id", input.id)
      .select(
        "id, slug, title, summary, body_md, category, status, visibility, visibility_roles, visibility_project_id",
      )
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to restore article.");
    }

    try {
      await appendKnowledgeArticleRevision({
        articleId: data.id,
        snapshot: toSnapshot(data),
        edit_note: input.edit_note ?? "Restored to draft",
      });
    } catch (err) {
      log.warn("knowledge_article_restore_revision_failed", {
        tenant_id: ctx.actor.tenantId,
        article_id: data.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    revalidatePath("/knowledge");
    revalidatePath(`/knowledge/${data.slug}`);

    return {
      result: { id: data.id, slug: data.slug },
      auditResourceId: data.id,
      auditOldValues: { status: "ARCHIVED" },
      auditNewValues: { status: "DRAFT", transition: "RESTORE" },
    };
  },
});
