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
      retrievalMode: "keyword" as const,
    },
    {
      slug: "approval-workflows",
      title: "Approval workflows",
      category: "approvals" as const,
      excerpt: "Threshold-based approval chains",
      source: "docs/product/approval-workflows.md",
      retrievalMode: "keyword" as const,
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

  it("does NOT emit the TOOLS block by default (Level 1 default is docs-only)", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "id",
      retrieved: baseRetrieved,
    });
    expect(prompt).not.toMatch(/TOOLS AVAILABLE/);
    // Rule 8 / 9 are tool-specific and must not appear.
    expect(prompt).not.toMatch(/Tools you can call/);
  });

  it("appends the TOOLS block AND tool-scoped rules only when toolsEnabled=true", () => {
    const prompt = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "id",
      retrieved: baseRetrieved,
      toolsEnabled: true,
    });
    expect(prompt).toContain("TOOLS AVAILABLE");
    // The three whitelisted tool names must be listed.
    expect(prompt).toContain("list_pending_approvals()");
    expect(prompt).toContain("my_projects()");
    expect(prompt).toContain("expense_summary_this_month()");
    // Argument-tampering guardrail explicitly present.
    expect(prompt).toContain(
      "MUST NOT try to pass tenant_id, user_id, employee_id",
    );
    // "Other user / other tenant" refusal guardrail present in
    // the tool-enabled prompt. Post-Level-2 the wording clarifies
    // that tenant-wide tools *do* exist but are role-gated, so
    // the assertion checks for the stable substrings only.
    expect(prompt).toContain("refuse and explain");
    expect(prompt).toContain("caller's own view");
  });

  it("carries the same read-only guardrail into the Level 2 prompt (regression)", () => {
    const l2 = buildSystemPrompt({
      tenantName: "PT Foo",
      locale: "id",
      retrieved: baseRetrieved,
      toolsEnabled: true,
    });
    // The mutation-refusal guardrail is REQUIRED at Level 2 —
    // Level 2 gets DB read access, so the "don't offer to change
    // records" wording must still be right there in the system
    // prompt. If a future refactor drops rule 4, we WANT this test
    // to fail loudly.
    expect(l2).toContain(
      "NEVER offer to approve, reject, settle, or otherwise change any record",
    );
  });
});
