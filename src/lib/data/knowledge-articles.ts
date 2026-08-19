import "server-only";

import { cache } from "react";

import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  canManageKnowledgeArticles,
  toCanonicalRole,
  type AnyDbEmployeeRole,
} from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import type {
  KnowledgeArticleCategory,
  KnowledgeArticleStatus,
  KnowledgeArticleVisibility,
} from "@/lib/validation/knowledge-article";

/**
 * Data loaders + revision writers for the tenant Knowledge Base.
 *
 * Every read here relies on `knowledge_articles_select` RLS
 * (migration 0095) to scope by tenant AND by draft-vs-published
 * visibility. Callers do NOT have to filter `tenant_id` in query
 * .eq() — RLS does it via the JWT claim. Keeping the app layer thin
 * means a wrong query returns 0 rows for the wrong tenant instead
 * of 500-ing on a leak.
 *
 * The `Author` shape is joined lazily via `employees` FK — RLS on
 * `employees` already blocks cross-tenant reads, so we can safely
 * expose the author's full name in the list view.
 */

export type KnowledgeArticle = {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  category: KnowledgeArticleCategory;
  status: KnowledgeArticleStatus;
  visibility: KnowledgeArticleVisibility;
  visibility_roles: string[];
  visibility_project_id: string | null;
  author_employee_id: string;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  view_count: number;
};

export type KnowledgeArticleWithAuthor = KnowledgeArticle & {
  author: {
    id: string;
    full_name: string;
  } | null;
};

const SELECT_WITH_AUTHOR = `
  id, tenant_id, slug, title, summary, body_md, category, status,
  visibility, visibility_roles, visibility_project_id,
  author_employee_id, published_at, archived_at,
  created_at, updated_at, view_count,
  author:employees!knowledge_articles_author_employee_id_fkey (
    id, full_name
  )
` as const;

// ---------------------------------------------------------------------------
// Visibility ACL (Phase 2c) — app-layer enforcement.
//
// Migration 0095 shipped the columns and the enum but explicitly left
// ROLE_GATED / PROJECT_SCOPED unenforced. The header comment named
// this helper as the plumbing point: "Visibility ACL is handled at
// the app layer — see resolveVisibilityFilter() in the data module."
// The filter runs on every read path that lists / retrieves articles
// (`loadKnowledgeArticles`, `loadRecentPublishedKnowledgeArticles`,
// `loadPublishedKnowledgeGrouped`, `loadTenantSearchIndex`, and the
// single-row lookups). Phase 2c-III will layer an RLS SELECT clause
// on top for defense-in-depth; until then this helper is the ONLY
// visibility check between the DB and the UI.
//
// Semantics (rows the caller is allowed to see, per branch):
//   • Admin (canManageKnowledgeArticles(role) === true) — everything.
//     No filter applied.
//   • Author of the row — always, regardless of visibility. Author
//     bypass sits inside the OR clause so it composes cleanly with
//     the visibility branches instead of taking a separate query.
//   • TENANT_WIDE — every tenant member.
//   • ROLE_GATED — caller's DB role OR its canonical fold must be in
//     `visibility_roles`. PostgREST `.ov.` = array overlap operator
//     (`&&` in SQL), so we compare a 1- or 2-element set against the
//     stored array.
//   • PROJECT_SCOPED — caller must have an ACTIVE assignment on
//     `visibility_project_id`. The set of active project ids is
//     loaded once per request via `loadVisibilityContext` and passed
//     into every call (React's `cache()` around the loader dedupes
//     the DB round-trip across list + hero + palette in a single
//     RSC render).
// ---------------------------------------------------------------------------

/**
 * Snapshot of everything the visibility filter needs to know about
 * the caller. Loaded once per request via `loadVisibilityContext`
 * (which is `cache()`-memoised, so a page that reads three
 * knowledge lists still runs the underlying assignment query once).
 */
export type KnowledgeVisibilityContext = {
  employeeId: string;
  role: AnyDbEmployeeRole;
  /** Project ids the caller currently holds an ACTIVE assignment on. */
  activeProjectIds: readonly string[];
  /** True if `canManageKnowledgeArticles(role)` — skip the filter. */
  isAdmin: boolean;
};

/**
 * Load the caller's visibility context. Runs one query against
 * `project_employee_assignments` to enumerate active project ids —
 * empty result is normal (plain employees, or employees between
 * projects). Wrapped in `cache()` so the layout + list + palette
 * share the same round-trip.
 */
export const loadVisibilityContext = cache(
  async (): Promise<KnowledgeVisibilityContext> => {
    const employee = await requireCurrentEmployee();
    const supabase = await createClient();
    const { data: assignments } = await supabase
      .from("project_employee_assignments")
      .select("project_id")
      .eq("employee_id", employee.id)
      .eq("status", "ACTIVE");
    return {
      employeeId: employee.id,
      role: employee.role,
      activeProjectIds: (assignments ?? []).map((a) => a.project_id),
      isAdmin: canManageKnowledgeArticles(employee.role),
    };
  },
);

/**
 * Build the PostgREST `.or()` clause for the visibility ACL. Returns
 * `null` when the caller is an admin — that path must NOT call
 * `.or()` at all (an empty filter would be a no-op that admits every
 * row anyway, but skipping the call spares a wire byte and reads
 * clearer at the call site).
 *
 * The clause structure:
 *
 *   visibility.eq.TENANT_WIDE,
 *   author_employee_id.eq.<uuid>,                                // author bypass
 *   and(visibility.eq.ROLE_GATED,visibility_roles.ov.{R1,R2}),
 *   and(visibility.eq.PROJECT_SCOPED,visibility_project_id.in.(uuid1,uuid2))
 *
 * The ROLE_GATED branch emits BOTH the caller's raw DB role AND its
 * canonical fold, so an article stored with either dialect
 * (`LEAD_FINANCE` vs `FINANCE`, `PROJECT_MANAGER` vs `PM`) matches a
 * caller sitting on either dialect too. Authors picking from the UI
 * always store canonical (Fase 2c-II), but the picker eventually
 * evolves — and legacy fixtures live in `supabase/seed/` and E2E
 * factories — so the filter admits both to keep test data working.
 *
 * The PROJECT_SCOPED branch is emitted only when the caller has ≥1
 * active project — otherwise the `.in.()` list would be empty and
 * PostgREST rejects the request.
 */
export function resolveVisibilityFilter(
  ctx: KnowledgeVisibilityContext,
): string | null {
  if (ctx.isAdmin) return null;

  // Role set: caller's DB role + its canonical fold. `toCanonicalRole`
  // is idempotent for canonical values (returns the same value)
  // which the dedupe below handles cleanly.
  const canonical = toCanonicalRole(ctx.role);
  const roleSet =
    canonical === ctx.role ? [ctx.role] : [ctx.role, canonical];
  const rolesLiteral = `{${roleSet.join(",")}}`;

  const parts = [
    "visibility.eq.TENANT_WIDE",
    `author_employee_id.eq.${ctx.employeeId}`,
    `and(visibility.eq.ROLE_GATED,visibility_roles.ov.${rolesLiteral})`,
  ];

  if (ctx.activeProjectIds.length > 0) {
    const projectList = `(${ctx.activeProjectIds.join(",")})`;
    parts.push(
      `and(visibility.eq.PROJECT_SCOPED,visibility_project_id.in.${projectList})`,
    );
  }

  return parts.join(",");
}

/**
 * Everything the current caller is allowed to see, newest first.
 *
 * RLS filters:
 *   • Non-admin author sees: published (any author) + their own drafts.
 *   • Admin sees: published + all drafts within the tenant.
 * Archived rows are included — the list view chooses whether to
 * render them based on the `status` filter passed to the page.
 */
export const loadKnowledgeArticles = cache(
  async (opts?: {
    status?: KnowledgeArticleStatus | KnowledgeArticleStatus[];
    category?: KnowledgeArticleCategory;
  }): Promise<KnowledgeArticleWithAuthor[]> => {
    const supabase = await createClient();
    const ctx = await loadVisibilityContext();
    let q = supabase
      .from("knowledge_articles")
      .select(SELECT_WITH_AUTHOR)
      .order("updated_at", { ascending: false });

    if (opts?.status) {
      if (Array.isArray(opts.status)) {
        q = q.in("status", opts.status);
      } else {
        q = q.eq("status", opts.status);
      }
    }
    if (opts?.category) {
      q = q.eq("category", opts.category);
    }

    const filter = resolveVisibilityFilter(ctx);
    if (filter) q = q.or(filter);

    const { data, error } = await q;
    if (error || !data) return [];
    return data as unknown as KnowledgeArticleWithAuthor[];
  },
);

/**
 * Single article by slug (URL key). Returns `null` when the caller
 * doesn't have permission — RLS will simply hide the row. The page
 * layer distinguishes that from "does not exist" via a 404.
 */
export async function loadKnowledgeArticleBySlug(
  slug: string,
): Promise<KnowledgeArticleWithAuthor | null> {
  const supabase = await createClient();
  const ctx = await loadVisibilityContext();
  let q = supabase
    .from("knowledge_articles")
    .select(SELECT_WITH_AUTHOR)
    .eq("slug", slug);
  const filter = resolveVisibilityFilter(ctx);
  if (filter) q = q.or(filter);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return data as unknown as KnowledgeArticleWithAuthor;
}

/**
 * Single article by primary key — used by the edit form loader and
 * the Server Action pre-mutation snapshot. Same RLS semantics as
 * the slug lookup.
 */
export async function loadKnowledgeArticleById(
  id: string,
): Promise<KnowledgeArticleWithAuthor | null> {
  const supabase = await createClient();
  const ctx = await loadVisibilityContext();
  let q = supabase
    .from("knowledge_articles")
    .select(SELECT_WITH_AUTHOR)
    .eq("id", id);
  const filter = resolveVisibilityFilter(ctx);
  if (filter) q = q.or(filter);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return data as unknown as KnowledgeArticleWithAuthor;
}

/**
 * "Recently updated" strip for the /knowledge landing hero. Cheap
 * — hits the (tenant, updated_at) index and stops at N rows.
 */
export const loadRecentPublishedKnowledgeArticles = cache(
  async (limit = 5): Promise<KnowledgeArticleWithAuthor[]> => {
    const supabase = await createClient();
    const ctx = await loadVisibilityContext();
    let q = supabase
      .from("knowledge_articles")
      .select(SELECT_WITH_AUTHOR)
      .eq("status", "PUBLISHED")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    const filter = resolveVisibilityFilter(ctx);
    if (filter) q = q.or(filter);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as unknown as KnowledgeArticleWithAuthor[];
  },
);

/**
 * Compact search-index shape — the minimum a fuzzy matcher needs.
 * Used by `HelpSearch` (`/help` browse tab) and the global command
 * palette (`Ctrl+K`) to surface tenant KB alongside repo docs.
 *
 * Deliberately does NOT include `body_md`. The preview is server-
 * rendered ONCE (stripped markdown, first 800 chars) so the client
 * bundle doesn't have to ship every article's full body just to
 * find one match. For a 100-article tenant this keeps the palette
 * payload well under 100 KB.
 */
export type KnowledgeSearchArticle = {
  slug: string;
  title: string;
  summary: string;
  category: KnowledgeArticleCategory;
  preview: string;
  updated_at: string;
};

/**
 * Load every published article the caller can see, projected down
 * to the search-friendly shape. RLS filters by tenant + visibility
 * (drafts stay out even for their own authors — the search box is
 * meant to surface reference material, not WIP).
 *
 * Memoised via `cache()` so RSC pages and the app-shell layout
 * (both server-rendered per request) share a single query.
 */
export const loadTenantSearchIndex = cache(
  async (): Promise<KnowledgeSearchArticle[]> => {
    const supabase = await createClient();
    const ctx = await loadVisibilityContext();
    let q = supabase
      .from("knowledge_articles")
      .select("slug, title, summary, category, body_md, updated_at")
      .eq("status", "PUBLISHED")
      .order("updated_at", { ascending: false })
      .limit(500);
    const filter = resolveVisibilityFilter(ctx);
    if (filter) q = q.or(filter);
    const { data, error } = await q;
    if (error || !data) return [];
    return data.map((row) => ({
      slug: row.slug,
      title: row.title,
      summary: row.summary ?? "",
      // `category` comes back as `string` because the generated
      // types treat the DB CHECK constraint as freeform. The value
      // is one of `KnowledgeArticleCategory` by construction — the
      // check on `knowledge_articles.category` rejects anything
      // else at INSERT time.
      category: row.category as KnowledgeArticleCategory,
      preview: stripAndClip(row.body_md, 800),
      updated_at: row.updated_at,
    }));
  },
);

/**
 * Same markdown-stripping recipe as `retrieval.ts::stripMarkdown` +
 * a length cap. Duplicated intentionally — the retrieval module is
 * `server-only` and lives inside `src/lib/help/`, and re-exporting
 * from there would forward the "no client bundle" restriction here.
 */
function stripAndClip(md: string, maxChars: number): string {
  const stripped = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > maxChars
    ? `${stripped.slice(0, maxChars - 1)}…`
    : stripped;
}

/**
 * Group published articles by category for the browse view — mirrors
 * the shape used by `renderHelpBrowse()` in the static /help route
 * so the two lists can share the same card component.
 */
export const loadPublishedKnowledgeGrouped = cache(
  async (): Promise<Record<string, KnowledgeArticleWithAuthor[]>> => {
    const rows = await loadKnowledgeArticles({ status: "PUBLISHED" });
    const grouped: Record<string, KnowledgeArticleWithAuthor[]> = {};
    for (const row of rows) {
      const bucket = grouped[row.category] ?? [];
      bucket.push(row);
      grouped[row.category] = bucket;
    }
    return grouped;
  },
);

// ---------------------------------------------------------------------------
// Revision writer.
// ---------------------------------------------------------------------------

/**
 * Append an immutable revision row for the given article. Called by
 * every Server Action after a successful UPDATE / lifecycle
 * transition. `revision_no` is computed inline with a single
 * SELECT+INSERT — a race here would only cause a duplicate-key
 * violation (unique on `(article_id, revision_no)`), which the
 * caller can retry safely because the trigger rejects UPDATE and
 * therefore no partial state is possible.
 *
 * NOTE: this runs under the caller's session, not service role.
 * `edited_by_employee_id` MUST equal the RLS-enforced identity or
 * the INSERT is rejected — see `knowledge_article_revisions_insert`.
 */
export async function appendKnowledgeArticleRevision(input: {
  articleId: string;
  snapshot: {
    title: string;
    summary: string | null;
    body_md: string;
    category: KnowledgeArticleCategory;
    status: KnowledgeArticleStatus;
    visibility: KnowledgeArticleVisibility;
    visibility_roles: string[];
    visibility_project_id: string | null;
  };
  edit_note?: string | null;
}): Promise<void> {
  const supabase = await createClient();
  const employee = await requireCurrentEmployee();

  const { data: latest } = await supabase
    .from("knowledge_article_revisions")
    .select("revision_no")
    .eq("article_id", input.articleId)
    .order("revision_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextRevisionNo = (latest?.revision_no ?? 0) + 1;

  const { error } = await supabase.from("knowledge_article_revisions").insert({
    tenant_id: employee.tenant_id,
    article_id: input.articleId,
    revision_no: nextRevisionNo,
    title: input.snapshot.title,
    summary: input.snapshot.summary,
    body_md: input.snapshot.body_md,
    category: input.snapshot.category,
    status: input.snapshot.status,
    visibility: input.snapshot.visibility,
    visibility_roles: input.snapshot.visibility_roles,
    visibility_project_id: input.snapshot.visibility_project_id,
    edited_by_employee_id: employee.id,
    edit_note: input.edit_note ?? null,
  });
  if (error) {
    throw new Error(`Failed to append article revision: ${error.message}`);
  }
}

/**
 * Increment the `view_count` counter. Best-effort — a failed update
 * is not surfaced to the caller because view counters are UX signal,
 * not correctness. Wrapped in a fire-and-forget style at the call
 * site.
 */
export async function bumpKnowledgeArticleViewCount(
  id: string,
): Promise<void> {
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("knowledge_articles")
    .select("view_count")
    .eq("id", id)
    .maybeSingle();
  if (!current) return;
  await supabase
    .from("knowledge_articles")
    .update({ view_count: current.view_count + 1 })
    .eq("id", id);
}
