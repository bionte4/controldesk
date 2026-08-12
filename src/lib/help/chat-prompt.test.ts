import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./chat-prompt";

describe("buildSystemPrompt", () => {
  const baseRetrieved = [
    {
      slug: "overview",
      title: "Overview",
      category: "getting-started" as const,
      excerpt: "ControlDesk is a multi-tenant ERP",
      source: "docs/product/overview.md",
    },
    {
      slug: "approval-workflows",
      title: "Approval workflows",
      category: "approvals" as const,
      excerpt: "Threshold-based approval chains",
      source: "docs/product/approval-workflows.md",
    },
  ];

  it("embeds the tenant name in the intro AND in the isolation clause", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Acme Nusantara",
      locale: "id",
      retrieved: baseRetrieved,
    });
    // Intro line references the tenant.
    expect(prompt).toContain('"PT Acme Nusantara"');
    // Isolation clause also references the tenant name — belt-and-braces.
    const isolationCount = (prompt.match(/PT Acme Nusantara/g) ?? []).length;
    expect(isolationCount).toBeGreaterThanOrEqual(2);
  });

  it("includes every retrieved slug in the CONTEXT block", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "en",
      retrieved: baseRetrieved,
    });
    expect(prompt).toContain("slug=overview");
    expect(prompt).toContain("slug=approval-workflows");
    expect(prompt).toContain("Threshold-based approval chains");
  });

  it("localises the refusal template to Indonesian by default", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "id",
      retrieved: baseRetrieved,
    });
    expect(prompt).toContain("Saya tidak menemukan jawabannya di dokumentasi");
    expect(prompt).not.toContain("I don't see that in the help docs");
  });

  it("localises the refusal template to English when locale=en", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "en",
      retrieved: baseRetrieved,
    });
    expect(prompt).toContain("I don't see that in the help docs");
    expect(prompt).not.toContain("Saya tidak menemukan jawabannya di dokumentasi");
  });

  it("instructs the model to refuse cross-tenant references and mutations", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "id",
      retrieved: baseRetrieved,
    });
    // Cross-tenant isolation guardrail.
    expect(prompt).toContain("NEVER discuss or reference any tenant other than");
    // Read-only guardrail — no approve/reject/settle.
    expect(prompt).toContain(
      "NEVER offer to approve, reject, settle, or otherwise change any record",
    );
  });

  it("teaches the citation contract via slug back-references", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "id",
      retrieved: baseRetrieved,
    });
    expect(prompt).toMatch(/bracketed reference like \[overview\]/);
    expect(prompt).toContain("matching the `slug=` in CONTEXT");
  });

  it("still renders a coherent prompt when retrieval returns nothing", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "id",
      retrieved: [],
    });
    // Empty context should still produce all the guardrails.
    expect(prompt).toContain("CONTEXT:");
    expect(prompt).toContain('"PT Foo"');
    // The teaching example about the `slug=` contract is always
    // present (it's inside the rules block). What must be absent is
    // any actual data slug entry like "slug=overview".
    expect(prompt).not.toMatch(/slug=[a-z-]+/);
  });
});
