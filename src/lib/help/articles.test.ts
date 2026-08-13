import { describe, expect, it } from "vitest";

import {
  HELP_CATEGORY_ORDER,
  HELP_MANIFEST,
  loadAllHelpArticles,
  loadHelpArticle,
  localeVariantPath,
} from "./articles";

describe("help article manifest", () => {
  it("has unique slugs — clashes would silently break deep-linked HelpHints", () => {
    const seen = new Set<string>();
    for (const entry of HELP_MANIFEST) {
      expect(seen.has(entry.slug), `duplicate slug: ${entry.slug}`).toBe(false);
      seen.add(entry.slug);
    }
  });

  it("only uses category ids declared in HELP_CATEGORY_ORDER", () => {
    const declared = new Set<string>(HELP_CATEGORY_ORDER);
    for (const entry of HELP_MANIFEST) {
      expect(
        declared.has(entry.category),
        `unknown category '${entry.category}' on '${entry.slug}'`,
      ).toBe(true);
    }
  });

  it("every source path is under docs/ and stays user-facing (excludes dev-only folders)", () => {
    const forbiddenPrefixes = [
      "docs/ops/",
      "docs/qa/",
      "docs/rfc/",
      "docs/reference/",
      "docs/api-reference.md",
      "docs/architecture.md",
      "docs/dev-tools.md",
      "docs/development.md",
      "docs/deployment.md",
      "docs/env-reference.md",
      "docs/security-model.md",
      "docs/testing.md",
    ];
    for (const entry of HELP_MANIFEST) {
      expect(
        entry.source.startsWith("docs/"),
        `manifest source must be under docs/: ${entry.source}`,
      ).toBe(true);
      for (const prefix of forbiddenPrefixes) {
        expect(
          entry.source.startsWith(prefix),
          `dev-only doc leaked into help manifest: ${entry.source}`,
        ).toBe(false);
      }
    }
  });
});

describe("loadHelpArticle", () => {
  it("returns null for an unknown slug so the route can render 404", async () => {
    const result = await loadHelpArticle("no-such-slug-exists");
    expect(result).toBeNull();
  });

  it("hydrates a known slug with derived title + summary from markdown", async () => {
    const first = HELP_MANIFEST[0]!;
    const article = await loadHelpArticle(first.slug);
    expect(article).not.toBeNull();
    expect(article!.slug).toBe(first.slug);
    expect(article!.category).toBe(first.category);
    // Non-empty markdown body means the file existed and was readable.
    expect(article!.markdown.length).toBeGreaterThan(0);
    // Title override wins when present, otherwise we derive one — either
    // way it must not be the raw slug fallback for a valid file.
    expect(article!.title.length).toBeGreaterThan(0);
    expect(article!.title).not.toBe(first.slug);
  });
});

describe("loadAllHelpArticles", () => {
  it("returns exactly one article per manifest entry, in manifest order", async () => {
    const articles = await loadAllHelpArticles();
    expect(articles).toHaveLength(HELP_MANIFEST.length);
    for (let i = 0; i < articles.length; i += 1) {
      expect(articles[i]!.slug).toBe(HELP_MANIFEST[i]!.slug);
    }
  });

  it("every article has non-empty derived (or overridden) title and body", async () => {
    const articles = await loadAllHelpArticles();
    for (const a of articles) {
      expect(a.title.length, `empty title on ${a.slug}`).toBeGreaterThan(0);
      expect(a.markdown.length, `empty body on ${a.slug}`).toBeGreaterThan(0);
    }
  });
});

describe("localeVariantPath", () => {
  it("returns the base filename for the default locale (id) — no suffix", () => {
    // ID is canonical; we don't want an `.id.md` sibling to be
    // required for every article.
    expect(localeVariantPath("docs/product/overview.md", "id")).toBe(
      "docs/product/overview.md",
    );
  });

  it("inserts the locale before the extension for non-default locales", () => {
    expect(localeVariantPath("docs/product/overview.md", "en")).toBe(
      "docs/product/overview.en.md",
    );
  });

  it("handles files with no extension by appending the locale", () => {
    // Defensive — no manifest entry hits this today, but we don't
    // want a follow-up "README" article to blow up.
    expect(localeVariantPath("docs/integrations/README", "en")).toBe(
      "docs/integrations/README.en",
    );
  });
});

describe("locale-aware fallback", () => {
  it("falls back to the base file when the requested locale variant is missing (translated=false)", async () => {
    // None of the current manifest entries has a `.en.md` sibling
    // yet, so requesting locale=en for any of them must hydrate the
    // canonical ID file and flag the article as untranslated.
    const first = HELP_MANIFEST[0]!;
    const article = await loadHelpArticle(first.slug, "en");
    expect(article).not.toBeNull();
    expect(article!.translated).toBe(false);
    expect(article!.sourceLocale).toBe("id");
    // The `source` field must point at the file we actually opened,
    // so the UI + audit trails stay honest about what was rendered.
    expect(article!.source.endsWith(".en.md")).toBe(false);
  });

  it("marks the article as translated when requested locale is the canonical (id)", async () => {
    const first = HELP_MANIFEST[0]!;
    const article = await loadHelpArticle(first.slug, "id");
    expect(article).not.toBeNull();
    expect(article!.translated).toBe(true);
    expect(article!.sourceLocale).toBe("id");
  });
});
