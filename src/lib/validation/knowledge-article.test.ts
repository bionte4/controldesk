import { describe, expect, it } from "vitest";

import {
  createKnowledgeArticleSchema,
  updateKnowledgeArticleSchema,
} from "@/lib/validation/knowledge-article";

/**
 * Fase 2c cross-field refinement tests.
 *
 * The DB CHECK constraint from migration 0098 is the ground truth
 * for these invariants — Zod refuses inconsistent input at the
 * app boundary so a client bug never reaches Postgres. These
 * tests lock the invariants + the error paths (which field name
 * the message binds to, so form UIs highlight the right control).
 */
// Zod v4 `.uuid()` enforces the RFC 4122 version + variant bits, so
// nil-flavoured `00000000-…-002` fixtures fail parse. Use a real
// generator-shape v4 UUID with the "4xxx" version nibble and "8-b"
// variant nibble.
const A_UUID = "3f0c8d5a-1a3e-4bc8-9f11-e7a1c2b3d4e5";
const PROJ = "3f0c8d5a-1a3e-4bc8-9f11-e7a1c2b3d4f6";

describe("createKnowledgeArticleSchema", () => {
  const BASE = {
    slug: "onboarding-checklist",
    title: "Onboarding checklist",
    body_md: "Step 1. ...",
    category: "user-guides" as const,
  };

  it("TENANT_WIDE with no side fields succeeds", () => {
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "TENANT_WIDE",
    });
    expect(res.success).toBe(true);
  });

  it("ROLE_GATED with roles succeeds", () => {
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "ROLE_GATED",
      visibility_roles: ["FINANCE", "ADMIN"],
    });
    expect(res.success).toBe(true);
  });

  it("ROLE_GATED without roles fails with visibility_roles error", () => {
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "ROLE_GATED",
      visibility_roles: [],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) =>
        i.path.includes("visibility_roles"),
      );
      expect(issue?.message).toMatch(/at least one role/i);
    }
  });

  it("ROLE_GATED with omitted roles field also fails (default is empty array)", () => {
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "ROLE_GATED",
    });
    expect(res.success).toBe(false);
  });

  it("PROJECT_SCOPED with project id succeeds", () => {
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "PROJECT_SCOPED",
      visibility_project_id: PROJ,
    });
    expect(res.success).toBe(true);
  });

  it("PROJECT_SCOPED without project id fails with visibility_project_id error", () => {
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "PROJECT_SCOPED",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) =>
        i.path.includes("visibility_project_id"),
      );
      expect(issue?.message).toMatch(/select a project/i);
    }
  });

  it("PROJECT_SCOPED with null project id fails", () => {
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "PROJECT_SCOPED",
      visibility_project_id: null,
    });
    expect(res.success).toBe(false);
  });

  it("rejects invalid visibility enum", () => {
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "PUBLIC" as never,
    });
    expect(res.success).toBe(false);
  });

  it("caps visibility_roles at 20 entries", () => {
    const twentyOne = Array.from({ length: 21 }, (_, i) => `ROLE_${i}`);
    const res = createKnowledgeArticleSchema.safeParse({
      ...BASE,
      visibility: "ROLE_GATED",
      visibility_roles: twentyOne,
    });
    // Fails either on the max(20) refinement or the enum
    // membership — either is acceptable, we just don't want it
    // to succeed silently.
    expect(res.success).toBe(false);
  });
});

describe("updateKnowledgeArticleSchema", () => {
  it("visibility omitted → superRefine skips (partial patch)", () => {
    const res = updateKnowledgeArticleSchema.safeParse({
      id: A_UUID,
      title: "New title",
    });
    expect(res.success).toBe(true);
  });

  it("switching to ROLE_GATED requires roles", () => {
    const res = updateKnowledgeArticleSchema.safeParse({
      id: A_UUID,
      visibility: "ROLE_GATED",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) =>
        i.path.includes("visibility_roles"),
      );
      expect(issue).toBeDefined();
    }
  });

  it("switching to PROJECT_SCOPED with project id succeeds", () => {
    const res = updateKnowledgeArticleSchema.safeParse({
      id: A_UUID,
      visibility: "PROJECT_SCOPED",
      visibility_project_id: PROJ,
    });
    expect(res.success).toBe(true);
  });

  it("switching to TENANT_WIDE ignores side fields (no refine error)", () => {
    // A client that toggles OUT of ROLE_GATED may still have
    // stale `visibility_roles` in state. The refine should NOT
    // reject — the server-action normaliser wipes those before
    // insert.
    const res = updateKnowledgeArticleSchema.safeParse({
      id: A_UUID,
      visibility: "TENANT_WIDE",
      visibility_roles: ["FINANCE"],
      visibility_project_id: PROJ,
    });
    expect(res.success).toBe(true);
  });
});
