import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";
import { cache } from "react";

import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

// Pure-data taxonomy lives in a client-safe sibling so client
// components (`help-search.tsx`, etc.) can `import` it without
// dragging the "server-only" fs code down with them. Re-exported
// here to preserve the historical import surface —
// `import { HELP_CATEGORY_META } from "@/lib/help/articles"` keeps
// working for the RSC callers that used it before the split.
export {
  HELP_CATEGORY_META,
  HELP_CATEGORY_ORDER,
  type HelpCategoryId,
} from "./categories";
import type { HelpCategoryId } from "./categories";

/**
 * Help-article registry (rules §17).
 *
 * The `/help` route reads user-facing docs from the top-level `docs/`
 * folder — the same folder devs already maintain via PRs. Rather than
 * scanning the whole tree (which would leak `docs/ops/*`,
 * `docs/qa/*`, `docs/reference/*`, etc. — dev-facing content), we
 * expose an explicit allowlist here.
 *
 * ## Why a manifest, not a globber
 *
 *   1. Editorial curation — not every markdown file is user-facing.
 *      `docs/architecture.md`, `docs/rfc/*`, `docs/api-reference.md`
 *      are for developers and would confuse end users.
 *   2. Stable IDs — the `slug` here is the URL. If we globbed on
 *      filesystem, moving a file would break `HelpHint` deep links.
 *   3. Category ordering — the manifest declares category order for
 *      the sidebar; alphabetical filesystem ordering would be worse
 *      UX ("Approvals" should come before "Timesheet", not "Zzz").
 *
 * ## How to add a new article
 *
 *   1. Write the markdown in `docs/…`. Optional YAML frontmatter:
 *        ---
 *        title: Custom title override
 *        summary: One-line description shown on the index
 *        ---
 *      If frontmatter is absent, `title` = first `#` heading,
 *      `summary` = first paragraph (trimmed to 160 chars).
 *   2. Add one line to `HELP_MANIFEST` below.
 *   3. Update `messages/{id,en}.json` if you want a translated
 *      category or article label (optional — the manifest values are
 *      used as fallbacks).
 *
 * The loader is memoised via `React.cache()` for per-request dedup,
 * so listing the index + rendering one article doesn't re-read the
 * same file twice.
 */

export type HelpArticleManifestEntry = {
  /** URL slug — appears at `/help/{slug}`. Must be stable; changing it breaks any HelpHint pointing at it. */
  slug: string;
  /** Category bucket for the sidebar. */
  category: HelpCategoryId;
  /** Path relative to the repo root — allows co-located docs. */
  source: string;
  /** Optional human title override; otherwise derived from frontmatter or first `#` heading. */
  titleOverride?: string;
  /** Optional 1-line summary override; otherwise derived from frontmatter or first paragraph. */
  summaryOverride?: string;
};

/**
 * Curated list of user-facing docs. Order within a category matters
 * for the sidebar — keep top of file = first thing new users should read.
 *
 * DEV-FACING docs deliberately excluded here (in case anyone wonders):
 *   docs/api-reference.md, docs/architecture.md, docs/dev-tools.md,
 *   docs/development.md, docs/deployment.md, docs/env-reference.md,
 *   docs/getting-started.md, docs/security-model.md, docs/testing.md,
 *   docs/ops/*, docs/qa/*, docs/reference/*, docs/rfc/*,
 *   docs/training/{README,curriculum,evaluation,facilitator-guide,hands-on-labs}.md
 */
export const HELP_MANIFEST: readonly HelpArticleManifestEntry[] = [
  // Getting started
  {
    slug: "overview",
    category: "getting-started",
    source: "docs/product/overview.md",
    titleOverride: "Apa itu ControlDesk?",
  },
  {
    slug: "roles-and-permissions",
    category: "getting-started",
    source: "docs/product/roles-and-permissions.md",
  },
  {
    slug: "glossary",
    category: "getting-started",
    source: "docs/product/glossary.md",
  },
  {
    // Personal account settings (theme, locale, notification channels,
    // Telegram / WhatsApp link). Visible to every authenticated user,
    // matches the sidebar Preferences entry.
    slug: "preferences",
    category: "getting-started",
    source: "docs/product/preferences.md",
  },
  {
    // Sequential end-to-end walkthrough — one fictional tenant
    // (PT Nusa Digital) journey from Super Admin provisioning
    // through the first project's delivery cycle, with concrete
    // sample data at every step. Complements the per-role
    // playbooks in `docs/user-guides/*` and the module deep-dives
    // in `docs/modules/*` — this one is the "start here" tour.
    slug: "end-to-end-walkthrough",
    category: "getting-started",
    source: "docs/product/end-to-end-walkthrough.md",
  },

  // User guides — role-based operational playbooks
  {
    slug: "internal-users",
    category: "user-guides",
    source: "docs/user-guides/internal-users.md",
  },
  {
    slug: "client-portal-users",
    category: "user-guides",
    source: "docs/user-guides/client-portal-users.md",
  },
  {
    slug: "workflows",
    category: "user-guides",
    source: "docs/training/user-guide-workflows.md",
    titleOverride: "Alur kerja per modul (visual)",
  },

  // Approvals — the most-asked area
  {
    slug: "approval-workflows",
    category: "approvals",
    source: "docs/product/approval-workflows.md",
  },

  // Finance
  {
    slug: "finance-module",
    category: "finance",
    source: "docs/modules/finance.md",
    titleOverride: "Modul Finance: expense, kas bon, kas kecil",
  },

  // HR
  {
    slug: "hris-payroll",
    category: "hr",
    source: "docs/modules/hris-and-payroll.md",
    titleOverride: "HR & Payroll",
  },

  // Projects
  {
    slug: "projects-module",
    category: "hr",
    source: "docs/modules/projects.md",
    titleOverride: "Modul Projects & Milestones",
  },

  // Clients
  {
    slug: "clients-and-portal",
    category: "hr",
    source: "docs/modules/clients-and-portal.md",
    titleOverride: "Klien & Client Portal",
  },

  // Integrations
  {
    slug: "integrations-overview",
    category: "integrations",
    source: "docs/integrations/README.md",
  },
  {
    slug: "telegram-bot",
    category: "integrations",
    source: "docs/integrations/telegram-bot.md",
  },
  {
    slug: "whatsapp-fonnte",
    category: "integrations",
    source: "docs/integrations/whatsapp-fonnte.md",
  },
  {
    slug: "ai-gemini",
    category: "integrations",
    source: "docs/integrations/ai-insights-gemini.md",
    titleOverride: "AI Insights (Google Gemini)",
  },

  // Reference
  {
    slug: "ai-and-notifications",
    category: "reference",
    source: "docs/modules/ai-and-notifications.md",
    titleOverride: "AI & sistem notifikasi",
  },
];

/**
 * Fully-hydrated article — manifest entry + parsed markdown source
 * + derived title/summary. Never sent as-is to the client; the route
 * strips the raw markdown before serialising.
 *
 * ## Locale fallback
 *
 * `sourceLocale` is the locale actually served (may differ from the
 * requested locale when a translation is missing). `translated` is
 * `true` iff the loader found a file for the requested locale. UI
 * uses these to decide whether to show a "translation not available"
 * banner. `id` (Indonesian) is the canonical source of truth; any
 * additional locale is opt-in via a `.{locale}.md` sibling.
 */
export type HelpArticle = {
  slug: string;
  category: HelpCategoryId;
  title: string;
  summary: string;
  markdown: string;
  source: string;
  sourceLocale: Locale;
  translated: boolean;
};

/**
 * Load one article by slug — returns null (not throws) for unknown
 * slugs so the route can render a proper 404 instead of a 500.
 * Memoised so the listing + article page don't double-read files.
 *
 * `locale` selects the preferred translation. When missing we fall
 * back to the base (Indonesian) file — hence the boolean surface on
 * the returned article. The cache key includes locale so different
 * locales don't stomp each other's cached shape.
 */
export const loadHelpArticle = cache(
  async (
    slug: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<HelpArticle | null> => {
    const entry = HELP_MANIFEST.find((e) => e.slug === slug);
    if (!entry) return null;
    return hydrate(entry, locale);
  },
);

/**
 * Load all articles. Called by the index page + the search-index
 * build step. Files are read in parallel; for ~15 files this is
 * ~5ms cold on any machine.
 *
 * The retrieval pipeline (`src/lib/help/retrieval.ts`) still calls
 * this without a locale — search must always index the canonical
 * (Indonesian) content so no article becomes invisible when a
 * translation is missing. The chatbot prompt already instructs the
 * model to answer in the user's UI locale, so grounding on ID docs
 * is fine.
 */
export const loadAllHelpArticles = cache(
  async (locale: Locale = DEFAULT_LOCALE): Promise<HelpArticle[]> => {
    return await Promise.all(HELP_MANIFEST.map((e) => hydrate(e, locale)));
  },
);

/**
 * Build the on-disk path for a locale-suffixed variant. `id` uses
 * the base filename (no suffix) because Indonesian is the canonical
 * source; every other locale looks for `foo.{locale}.md`.
 *
 * Kept exported for tests so we don't have to duplicate the naming
 * rule.
 */
export function localeVariantPath(base: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return base;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return `${base}.${locale}`;
  return `${base.slice(0, dot)}.${locale}${base.slice(dot)}`;
}

async function hydrate(
  entry: HelpArticleManifestEntry,
  locale: Locale,
): Promise<HelpArticle> {
  const requestedSource = localeVariantPath(entry.source, locale);
  let resolvedSource = requestedSource;
  let raw: string;
  let translated = true;
  try {
    raw = await readFile(path.join(process.cwd(), requestedSource), "utf8");
  } catch {
    if (locale === DEFAULT_LOCALE) throw new Error(`Missing help article file: ${entry.source}`);
    // Locale variant absent — fall back to canonical (Indonesian).
    raw = await readFile(path.join(process.cwd(), entry.source), "utf8");
    resolvedSource = entry.source;
    translated = false;
  }
  const parsed = matter(raw);
  const frontmatterTitle =
    typeof parsed.data.title === "string" ? parsed.data.title : undefined;
  const frontmatterSummary =
    typeof parsed.data.summary === "string" ? parsed.data.summary : undefined;
  const title =
    entry.titleOverride ??
    frontmatterTitle ??
    extractFirstHeading(parsed.content) ??
    entry.slug;
  const summary =
    entry.summaryOverride ??
    frontmatterSummary ??
    extractFirstParagraph(parsed.content) ??
    "";
  return {
    slug: entry.slug,
    category: entry.category,
    title,
    summary,
    markdown: parsed.content,
    source: resolvedSource,
    sourceLocale: translated ? locale : DEFAULT_LOCALE,
    translated,
  };
}

/**
 * Pull "Foo" out of `# Foo\n\n…`. Also handles `#Foo` (no space) and
 * trims trailing whitespace. Returns undefined if no `#` heading is
 * found in the first 20 non-empty lines — we don't want to walk the
 * whole file just for a fallback title.
 */
function extractFirstHeading(md: string): string | undefined {
  const lines = md.split("\n");
  let seen = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    seen += 1;
    if (line.startsWith("#")) {
      return line.replace(/^#+\s*/, "").trim() || undefined;
    }
    if (seen > 20) break;
  }
  return undefined;
}

/**
 * First non-heading, non-empty paragraph, truncated at 200 chars +
 * `…` — good enough for a listing summary. Skips fenced code and
 * blockquotes since those don't summarise well.
 */
function extractFirstParagraph(md: string): string | undefined {
  const lines = md.split("\n");
  const buf: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (!trimmed) {
      if (buf.length) break;
      continue;
    }
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith(">")) continue;
    buf.push(trimmed);
    if (buf.join(" ").length > 200) break;
  }
  if (!buf.length) return undefined;
  const joined = buf.join(" ").replace(/\*+/g, "").replace(/`/g, "");
  return joined.length > 200 ? `${joined.slice(0, 197).trimEnd()}…` : joined;
}
