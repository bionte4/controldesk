import { describe, expect, it } from "vitest";

import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ID,
  cosineSimilarity,
  loadEmbeddingIndex,
  normalize,
  rankByVector,
} from "./embeddings";

describe("cosineSimilarity", () => {
  it("returns 1 for two identical unit vectors", () => {
    const v = normalize([1, 2, 3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    // The pair we normalise both sides of the dot product on, so any
    // pair of unit vectors that dot to zero is fine.
    const a = normalize([1, 0, 0, 0]);
    const b = normalize([0, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it("guards against a zero-magnitude second vector", () => {
    const a = [1, 2, 3];
    const b = [0, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("normalize", () => {
  it("returns a unit vector for non-zero input", () => {
    const out = normalize([3, 4]);
    // Sanity: 3-4-5 triangle → unit vector is 0.6, 0.8.
    expect(out).toHaveLength(2);
    expect(out[0]!).toBeCloseTo(0.6, 6);
    expect(out[1]!).toBeCloseTo(0.8, 6);
    // Magnitude should be exactly 1 within FP tolerance.
    const mag = Math.hypot(...out);
    expect(mag).toBeCloseTo(1, 6);
  });

  it("returns a copy for a zero vector to avoid mutating callers", () => {
    const src = [0, 0, 0];
    const out = normalize(src);
    expect(out).not.toBe(src);
    expect(out).toEqual([0, 0, 0]);
  });
});

describe("loadEmbeddingIndex", () => {
  it("loads the precomputed index (16 articles) with the expected shape", () => {
    const index = loadEmbeddingIndex();
    expect(index).not.toBeNull();
    // ! is safe — the assertion above would have already failed.
    expect(index!.modelId).toBe(EMBEDDING_MODEL_ID);
    expect(index!.dim).toBe(EMBEDDING_DIM);
    expect(index!.entries.length).toBeGreaterThan(0);
    for (const entry of index!.entries) {
      expect(typeof entry.slug).toBe("string");
      expect(entry.vector).toHaveLength(EMBEDDING_DIM);
    }
  });

  it("ranks the correct article for a domain-specific query vector", () => {
    const index = loadEmbeddingIndex();
    expect(index).not.toBeNull();
    // We can't compare to a real query vector without a live embedding
    // call, but we can prove `rankByVector` is stable and picks the
    // top article deterministically when we feed it back its own row.
    // Pick "approval-workflows" — a common ask for the chatbot.
    const target = index!.entries.find((e) => e.slug === "approval-workflows");
    expect(target).toBeDefined();
    const top = rankByVector(index!, target!.vector, 3);
    // Feeding an entry's own vector back must rank that entry first.
    expect(top[0]!.entry.slug).toBe("approval-workflows");
    expect(top[0]!.score).toBeCloseTo(1, 3);
  });
});
