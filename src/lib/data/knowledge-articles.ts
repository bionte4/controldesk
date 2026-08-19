import "server-only";

import { cache } from "react";

import { requireCurrentEmployee } from "@/lib/auth/session";
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
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select(SELECT_WITH_AUTHOR)
    .eq("slug", slug)
    .maybeSingle();
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
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select(SELECT_WITH_AUTHOR)
    .eq("id", id)
    .maybeSingle();
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
    const { data, error } = await supabase
      .from("knowledge_articles")
      .select(SELECT_WITH_AUTHOR)
      .eq("status", "PUBLISHED")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit);
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
    const { data, error } = await supabase
      .from("knowledge_articles")
      .select("slug, title, summary, category, body_md, updated_at")
      .eq("status", "PUBLISHED")
      .order("updated_at", { ascending: false })
      .limit(500);
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
