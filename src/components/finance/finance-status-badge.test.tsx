/**
 * Unit tests for `<FinanceStatusBadge>` (rules §21).
 *
 * Component is a very thin wrapper around `<Badge variant="outline">`, but
 * we still lock the rendering shape in place because 9+ finance detail /
 * list pages depend on it — regressing the tone-class propagation,
 * variant, or forwarded attributes would silently degrade every finance
 * surface at once.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FinanceStatusBadge } from "./finance-status-badge";

describe("<FinanceStatusBadge>", () => {
  it("renders label text", () => {
    const html = renderToStaticMarkup(
      <FinanceStatusBadge label="Approved" tone="bg-emerald-500/10" />,
    );
    expect(html).toContain("Approved");
  });

  it("propagates the tone class untouched", () => {
    const html = renderToStaticMarkup(
      <FinanceStatusBadge
        label="Approved"
        tone="border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      />,
    );
    expect(html).toContain("border-emerald-500/40");
    expect(html).toContain("bg-emerald-500/10");
    expect(html).toContain("text-emerald-500");
  });

  it("uses the outline badge variant so callers cannot drift", () => {
    const html = renderToStaticMarkup(
      <FinanceStatusBadge label="Draft" tone="text-muted-foreground" />,
    );
    expect(html).toContain('data-variant="outline"');
  });

  it("forwards data-testid to the underlying <span>", () => {
    const html = renderToStaticMarkup(
      <FinanceStatusBadge
        label="Paid"
        tone="text-emerald-500"
        data-testid="foo-status"
      />,
    );
    expect(html).toContain('data-testid="foo-status"');
  });

  it("forwards title so long-form context surfaces on hover / to a11y", () => {
    const html = renderToStaticMarkup(
      <FinanceStatusBadge
        label="Approved"
        tone="text-emerald-500"
        title="Approved by Finance on 2026-08-09"
      />,
    );
    expect(html).toContain('title="Approved by Finance on 2026-08-09"');
  });

  it("appends caller-supplied className without replacing tone", () => {
    const html = renderToStaticMarkup(
      <FinanceStatusBadge
        label="Draft"
        tone="text-muted-foreground"
        className="extra-marker"
      />,
    );
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("extra-marker");
  });

  it("does not swallow whitespace in tone (defensive)", () => {
    // Multiple tone tokens must all survive verbatim — the badge does not
    // dedupe or reorder them, so tests break loudly if a wrapper starts
    // normalising className strings.
    const html = renderToStaticMarkup(
      <FinanceStatusBadge label="X" tone="a b c" />,
    );
    expect(html).toContain(" a ");
    expect(html).toContain(" b ");
    expect(html).toContain(" c");
  });
});
