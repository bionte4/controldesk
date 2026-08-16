import { describe, expect, it } from "vitest";

import {
  parseKnowledgeCitation,
  toKnowledgeCitationSlug,
} from "./knowledge-retrieval";

/**
 * Unit tests for the citation slug namespace helpers.
 *
 * These are pure functions with no I/O, but they're the linchpin
 * of the Fase 2 RAG merge: the chat prompt teaches the LLM to
 * emit `[kb-…]` for tenant articles, and the client renderer
 * (`ask-ai-sheet.tsx` / `help-ask-panel.tsx`) inverts the mapping
 * to route citations to `/knowledge/{slug}` instead of
 * `/help/{slug}`. If either side of that contract drifts, tenant
 * citations silently 404 or leak into the wrong route.
 */
describe("knowledge-retrieval citation namespace", () => {
  it("round-trips a slug through the kb- prefix", () => {
    const raw = "onboarding-checklist";
    const cited = toKnowledgeCitationSlug(raw);
    expect(cited).toBe("kb-onboarding-checklist");
    expect(parseKnowledgeCitation(cited)).toEqual({ slug: raw });
  });

  it("preserves nested hyphens without over-stripping", () => {
    const raw = "how-to-request-cash-advance";
    const cited = toKnowledgeCitationSlug(raw);
    expect(parseKnowledgeCitation(cited)).toEqual({ slug: raw });
  });

  it("returns null for repo-style citations", () => {
    expect(parseKnowledgeCitation("overview")).toBeNull();
    expect(parseKnowledgeCitation("approval-workflows")).toBeNull();
  });

  it("returns null for kb- prefix with empty tail", () => {
    // Guards against a hallucinated `[kb-]` from the model — we
    // never want that to link to `/knowledge/` (index page).
    expect(parseKnowledgeCitation("kb-")).toBeNull();
  });

  it("does not treat words starting with `kb` (without hyphen) as tenant citations", () => {
    // `kbytes-per-second` is a plausible repo slug; must not be
    // misrouted to `/knowledge/ytes-per-second`.
    expect(parseKnowledgeCitation("kbytes-per-second")).toBeNull();
  });
});
