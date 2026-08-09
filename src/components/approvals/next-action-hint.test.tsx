/**
 * Unit tests for `<NextActionHint>` (rules §21).
 *
 * Runs under the `node` Vitest environment via `renderToStaticMarkup` — same
 * pattern as `<ApprovalTimeline>` and `<FinanceStatusBadge>`. The component
 * is stateless and RSC-safe so every branch is deterministic given props.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NextActionHint, type NextActionHintIntent } from "./next-action-hint";

describe("<NextActionHint> — accessibility scaffolding", () => {
  it("emits role=status + aria-live=polite so screen readers announce state changes", () => {
    const html = renderToStaticMarkup(
      <NextActionHint intent="pending" title="Menunggu approval Finance" />,
    );
    // These two attributes together satisfy WCAG 4.1.3 — dynamic status
    // updates must be announced. See the component's a11y section.
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("marks the intent as a data-* attribute for E2E hooks", () => {
    const html = renderToStaticMarkup(
      <NextActionHint
        intent="approved"
        title="Sudah disetujui"
        data-testid="hint"
      />,
    );
    expect(html).toContain('data-intent="approved"');
    expect(html).toContain('data-testid="hint"');
  });

  it("forwards additional className without dropping intent classes", () => {
    const html = renderToStaticMarkup(
      <NextActionHint
        intent="pending"
        title="Pending"
        className="mt-8 shadow-lg"
      />,
    );
    // Both the caller's classes and the component's own classes must
    // survive `cn()` — this guards against a future regression where
    // the component overwrites instead of appends.
    expect(html).toContain("mt-8");
    expect(html).toContain("shadow-lg");
    expect(html).toContain("rounded-xl");
  });
});

describe("<NextActionHint> — intent → visual language", () => {
  const cases: Array<{
    intent: NextActionHintIntent;
    /** A distinctive class from the intent's `container` string. */
    marker: string;
  }> = [
    { intent: "pending", marker: "border-primary/30" },
    { intent: "approved", marker: "border-emerald-500/40" },
    { intent: "rejected", marker: "border-rose-500/40" },
    { intent: "cancelled", marker: "bg-muted/40" },
    { intent: "info", marker: "bg-muted/30" },
  ];

  it.each(cases)(
    "applies the $intent palette container class ($marker)",
    ({ intent, marker }) => {
      const html = renderToStaticMarkup(
        <NextActionHint intent={intent} title="Title" />,
      );
      expect(html).toContain(marker);
    },
  );

  it("uses the default intent icon when no override is provided", () => {
    // The pending intent's default icon is <Clock /> from lucide-react;
    // rendered SVG carries the `lucide-clock` class we can pattern-match on.
    const html = renderToStaticMarkup(
      <NextActionHint intent="pending" title="Title" />,
    );
    expect(html).toContain("lucide-clock");
    // Pending description is optional — banner should still render.
    expect(html).toContain("Title");
  });

  it("respects a custom icon override across all intents", () => {
    const CustomIcon = (
      <svg data-testid="custom-icon">
        <title>x</title>
      </svg>
    );
    const html = renderToStaticMarkup(
      <NextActionHint
        intent="approved"
        title="Sudah disetujui"
        icon={CustomIcon}
      />,
    );
    // Custom icon rendered instead of the default CheckCircle2 for the
    // approved intent.
    expect(html).toContain('data-testid="custom-icon"');
    expect(html).not.toContain("lucide-circle-check");
    expect(html).not.toContain("lucide-check-circle");
  });
});

describe("<NextActionHint> — content branches", () => {
  it("renders the title in the heading position", () => {
    const html = renderToStaticMarkup(
      <NextActionHint intent="pending" title="Menunggu approval PM" />,
    );
    expect(html).toContain("Menunggu approval PM");
  });

  it("renders the description below the title when provided", () => {
    const html = renderToStaticMarkup(
      <NextActionHint
        intent="pending"
        title="Menunggu approval PM"
        description="Amount melewati threshold PM."
      />,
    );
    expect(html).toContain("Menunggu approval PM");
    expect(html).toContain("Amount melewati threshold PM.");
  });

  it("omits the description block entirely when not provided", () => {
    const html = renderToStaticMarkup(
      <NextActionHint intent="approved" title="Sudah disetujui" />,
    );
    // The description slot uses `text-xs text-muted-foreground` — verify
    // that no such block is emitted when the prop is absent.
    expect(html).toContain("Sudah disetujui");
    expect(html).not.toContain('class="mt-0.5 text-xs text-muted-foreground"');
  });

  it("supports React node as description (not just string)", () => {
    const html = renderToStaticMarkup(
      <NextActionHint
        intent="pending"
        title="Pending"
        description={
          <span data-testid="rich-desc">
            <strong>bold</strong> and <em>italic</em>
          </span>
        }
      />,
    );
    expect(html).toContain('data-testid="rich-desc"');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders children slot below description", () => {
    const html = renderToStaticMarkup(
      <NextActionHint
        intent="pending"
        title="Pending"
        description="desc"
      >
        <button data-testid="approve-btn">Approve</button>
      </NextActionHint>,
    );
    expect(html).toContain('data-testid="approve-btn"');
    expect(html).toContain("Approve");
  });

  it("omits the children slot wrapper when no children are passed", () => {
    const html = renderToStaticMarkup(
      <NextActionHint intent="info" title="Info" />,
    );
    // The children wrapper uses `pl-12` indentation — ensure it doesn't
    // leak an empty div when unused.
    expect(html).not.toContain('class="pl-12"');
  });
});
