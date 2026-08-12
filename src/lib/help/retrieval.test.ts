import { describe, expect, it } from "vitest";

import { retrieveContext } from "./retrieval";

describe("retrieveContext", () => {
  it("returns the top-3 manifest articles when the query is shorter than the min match length", async () => {
    // Empty query → head of manifest (getting-started content).
    const result = await retrieveContext("", 3);
    expect(result).toHaveLength(3);
    // First one should be the pinned overview per HELP_MANIFEST order.
    expect(result[0]!.slug).toBe("overview");
  });

  it("returns at most `limit` results for a real query", async () => {
    const result = await retrieveContext("approval", 3);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(3);
    // Every hit has non-empty title + excerpt fields.
    for (const hit of result) {
      expect(hit.title.length).toBeGreaterThan(0);
      expect(hit.excerpt.length).toBeGreaterThan(0);
      expect(hit.source).toMatch(/^docs\//);
    }
  });

  it("finds the approval-workflows article for a domain-specific keyword", async () => {
    // "threshold" is a term unique to the approval-workflows article
    // in this project's docs — a hit here means keyword retrieval is
    // actually ranking on content, not just returning noise.
    const result = await retrieveContext("threshold approval", 3);
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("approval-workflows");
  });

  it("excerpt is bounded to the configured length window", async () => {
    const result = await retrieveContext("field ops", 3);
    for (const hit of result) {
      // 800 char body + optional …… wrappers means we allow a small
      // margin over the raw window.
      expect(hit.excerpt.length).toBeLessThanOrEqual(820);
    }
  });
});
