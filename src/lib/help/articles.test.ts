import { describe, expect, it } from "vitest";

import {
  HELP_CATEGORY_ORDER,
  HELP_MANIFEST,
  loadAllHelpArticles,
  loadHelpArticle,
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
