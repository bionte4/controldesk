/**
 * Unit tests for `<ApprovalActionDialog>` (rules §21).
 *
 * The component is a client component with hooks (useTransition,
 * useForm, useRouter, Sonner toast) — full interactive testing requires
 * jsdom + testing-library which the codebase intentionally hasn't
 * adopted (see approval-timeline.test.tsx rationale).
 *
 * These tests therefore only exercise what `renderToStaticMarkup` can
 * see: the trigger button — variant, icon, label, testId, disabled
 * state. The dialog body only renders once opened, which requires a
 * live DOM.
 *
 * Full interaction coverage lives in Playwright E2E — see
 * `e2e/expense-approval.spec.ts` etc.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";

// Sonner touches `document` at module load. Stub it so RSC-side
// rendering doesn't crash.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
// `next/navigation` requires a Next.js request context. Stub the
// router hook to a no-op object.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ApprovalActionDialog } from "./approval-action-dialog";

const noopAction = vi.fn(async () => ({ ok: true }) as const);
const schema = z.object({ id: z.string(), comment: z.string() });

const baseProps = {
  schema,
  defaultValues: { id: "test-1", comment: "" },
  fields: [{ name: "comment", label: "Comment" } as const],
  action: noopAction,
  triggerLabel: "Do it",
  title: "Confirm",
  description: "Are you sure?",
  confirmLabel: "Yes",
  cancelLabel: "No",
  successToast: "Done",
};

describe("<ApprovalActionDialog> — trigger button", () => {
  it("renders the trigger label", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog intent="approve" {...baseProps} />,
    );
    expect(html).toContain("Do it");
  });

  it("uses the default 'approve' intent icon (check)", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog intent="approve" {...baseProps} />,
    );
    // Lucide's Check icon renders as an <svg> with data-testid or via
    // class. The simplest deterministic check: a `<svg>` inside the
    // trigger button.
    expect(html).toContain("<svg");
  });

  it("switches trigger to destructive variant for intent=reject", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog
        intent="reject"
        {...baseProps}
        triggerLabel="Reject"
      />,
    );
    // The base-ui Button primitive expresses variant through Tailwind
    // classes — not `data-variant`. Destructive variant produces
    // `bg-destructive/10 text-destructive` on the trigger.
    expect(html).toContain("bg-destructive");
    expect(html).toContain("text-destructive");
    expect(html).toContain("Reject");
  });

  it("forwards data-testid to the trigger with -trigger suffix", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog
        intent="approve"
        {...baseProps}
        testId="foo"
      />,
    );
    expect(html).toContain('data-testid="foo-trigger"');
  });

  it("renders trigger disabled when `disabled` prop is true", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog
        intent="approve"
        {...baseProps}
        disabled
      />,
    );
    expect(html).toContain("disabled");
  });

  it("supports every declared intent without crashing", () => {
    const intents = [
      "approve",
      "reject",
      "disburse",
      "return",
      "cancel",
      "submit",
      "custom",
    ] as const;
    for (const intent of intents) {
      const html = renderToStaticMarkup(
        <ApprovalActionDialog intent={intent} {...baseProps} />,
      );
      // Every branch should at minimum produce the trigger label.
      expect(html).toContain("Do it");
    }
  });

  it("respects a custom icon override", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog
        intent="approve"
        {...baseProps}
        icon={<span data-marker="custom-icon">X</span>}
      />,
    );
    expect(html).toContain('data-marker="custom-icon"');
  });
});
