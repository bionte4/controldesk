import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { retrieveContext } from "./retrieval";

// The tests below use the real fuse.js index (no mocks needed for
// keyword-tier assertions). To force the KEYWORD fallback path for
// tier-independent assertions, we blank out the embedding API keys.
const originalHelpKey = process.env.HELP_EMBEDDING_API_KEY;
const originalGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

beforeEach(() => {
  delete process.env.HELP_EMBEDDING_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
});

afterEach(() => {
  if (originalHelpKey === undefined) delete process.env.HELP_EMBEDDING_API_KEY;
  else process.env.HELP_EMBEDDING_API_KEY = originalHelpKey;
  if (originalGoogleKey === undefined)
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogleKey;
  vi.restoreAllMocks();
});

describe("retrieveContext", () => {
  it("returns the top-3 manifest articles when the query is shorter than the min match length", async () => {
    // Empty query → head of manifest (getting-started content).
    const result = await retrieveContext("", 3);
    expect(result).toHaveLength(3);
    // First one should be the pinned overview per HELP_MANIFEST order.
    expect(result[0]!.slug).toBe("overview");
    expect(result[0]!.retrievalMode).toBe("manifest");
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

  it("marks keyword-tier hits so downstream telemetry can distinguish them", async () => {
    // No API keys → embedding tier bails out fast, keyword tier runs.
    const result = await retrieveContext("approval", 3);
    expect(result.length).toBeGreaterThan(0);
    for (const hit of result) {
      expect(hit.retrievalMode).toBe("keyword");
    }
  });

  it("uses embedding retrieval when a query vector is available", async () => {
    // Stub the embedding query so the test doesn't hit Google's API.
    // Any deterministic vector works — the ranking function trusts
    // whatever geometry we supply.
    const embeddings = await import("./embeddings");
    const stub = vi
      .spyOn(embeddings, "embedQuery")
      .mockResolvedValue(new Array(embeddings.EMBEDDING_DIM).fill(0.001));
    try {
      const result = await retrieveContext("finance approvals workflow", 3);
      expect(result.length).toBeGreaterThan(0);
      for (const hit of result) {
        expect(hit.retrievalMode).toBe("embedding");
      }
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      stub.mockRestore();
    }
  });
});
