/**
 * Unit tests for `<ApprovalTimeline>` (rules §21).
 *
 * The Vitest suite runs under `environment: "node"`, so we lean on
 * `react-dom/server`'s `renderToStaticMarkup` for a lightweight HTML
 * snapshot rather than pulling jsdom + testing-library. This is
 * sufficient because the component is stateless and RSC-safe — every
 * output branch is deterministic given its props.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ApprovalTimeline,
  initialsFrom,
  type ApprovalTimelineEntry,
} from "./approval-timeline";
import type { ApprovalAction } from "@/types/database";

const ACTION_LABEL: Record<ApprovalAction, string> = {
  SUBMIT: "Submitted",
  APPROVE: "Approved",
  REJECT: "Rejected",
  CANCEL: "Cancelled",
  FINANCE_APPROVE: "Finance approved",
  FINANCE_REJECT: "Finance rejected",
};

const ACTION_TONE: Record<ApprovalAction, string> = {
  SUBMIT: "tone-submit",
  APPROVE: "tone-approve",
  REJECT: "tone-reject",
  CANCEL: "tone-cancel",
  FINANCE_APPROVE: "tone-finance-approve",
  FINANCE_REJECT: "tone-finance-reject",
};

const statusLabels: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
};

function fmt(status: string): string {
  return statusLabels[status] ?? status;
}

const baseEntry: ApprovalTimelineEntry = {
  id: 1,
  action: "SUBMIT",
  actor: { full_name: "Budi Santoso" },
  actor_role: "PROJECT_MANAGER",
  from_status: "DRAFT",
  to_status: "SUBMITTED",
  comment: null,
  created_at: "2026-08-09T03:15:00Z",
};

describe("initialsFrom()", () => {
  it("returns two initials for two-word names", () => {
    expect(initialsFrom("Budi Santoso")).toBe("BS");
  });

  it("returns first + last initials for many-word names", () => {
    expect(initialsFrom("Iqbal Wicaksono Haryanto")).toBe("IH");
  });

  it("returns two-letter slice for single-word names", () => {
    expect(initialsFrom("Budi")).toBe("BU");
  });

  it("handles single-letter names without crashing", () => {
    expect(initialsFrom("B")).toBe("B");
  });

  it("returns empty string for null / undefined / whitespace input", () => {
    expect(initialsFrom(null)).toBe("");
    expect(initialsFrom(undefined)).toBe("");
    expect(initialsFrom("")).toBe("");
    expect(initialsFrom("   ")).toBe("");
  });

  it("uppercases lowercase names", () => {
    expect(initialsFrom("budi santoso")).toBe("BS");
  });

  it("collapses multiple internal spaces", () => {
    expect(initialsFrom("Budi    Santoso")).toBe("BS");
  });
});

describe("<ApprovalTimeline> — empty state", () => {
  it("renders the emptyLabel when entries is empty", () => {
    const html = renderToStaticMarkup(
      <ApprovalTimeline
        entries={[]}
        actionLabelMap={ACTION_LABEL}
        actionToneMap={ACTION_TONE}
        formatStatus={fmt}
        emptyLabel="Belum ada aktivitas."
        data-testid="tl"
      />,
    );
    expect(html).toContain("Belum ada aktivitas.");
    // Empty state uses the -empty testid suffix so E2E can distinguish
    // the two branches without inspecting text content.
    expect(html).toContain('data-testid="tl-empty"');
    // Should NOT render an <ol> — the "no entries" branch is a plain <p>.
    expect(html).not.toContain("<ol");
  });
});

describe("<ApprovalTimeline> — happy path", () => {
  it("renders one <li> per entry with badge + actor + status transition", () => {
    const entries: ApprovalTimelineEntry[] = [
      baseEntry,
      {
        ...baseEntry,
        id: 2,
        action: "APPROVE",
        actor: { full_name: "Ani Wijaya" },
        actor_role: "LEAD_FINANCE",
        from_status: "SUBMITTED",
        to_status: "APPROVED",
        comment: "OK to disburse",
        created_at: "2026-08-09T04:20:00Z",
      },
    ];

    const html = renderToStaticMarkup(
      <ApprovalTimeline
        entries={entries}
        actionLabelMap={ACTION_LABEL}
        actionToneMap={ACTION_TONE}
        formatStatus={fmt}
        emptyLabel="empty"
        ariaLabel="Test timeline"
        data-testid="tl"
      />,
    );

    // Ordered list with aria-label
    expect(html).toContain("<ol");
    expect(html).toContain('aria-label="Test timeline"');
    expect(html).toContain('role="list"');
    expect(html).toContain('data-testid="tl"');

    // Actor names
    expect(html).toContain("Budi Santoso");
    expect(html).toContain("Ani Wijaya");

    // Action labels
    expect(html).toContain("Submitted");
    expect(html).toContain("Approved");

    // Action tone class propagated
    expect(html).toContain("tone-submit");
    expect(html).toContain("tone-approve");

    // Status transition uses the caller-supplied formatter
    expect(html).toContain("Draft");

    // Comment shows only for entries that have one
    expect(html).toContain("OK to disburse");

    // Machine-readable timestamp for a11y. Note that
    // `renderToStaticMarkup` preserves camelCase JSX attribute names
    // (`dateTime`); the browser lowercases them in a real DOM but the
    // string output does not.
    expect(html).toContain('dateTime="2026-08-09T03:15:00Z"');
    expect(html).toContain('dateTime="2026-08-09T04:20:00Z"');
  });

  it("renders 'System' fallback when actor is null", () => {
    const html = renderToStaticMarkup(
      <ApprovalTimeline
        entries={[{ ...baseEntry, actor: null, actor_role: null }]}
        actionLabelMap={ACTION_LABEL}
        actionToneMap={ACTION_TONE}
        formatStatus={fmt}
        emptyLabel="empty"
      />,
    );
    expect(html).toContain("System");
  });

  it("respects a custom systemLabel override", () => {
    const html = renderToStaticMarkup(
      <ApprovalTimeline
        entries={[{ ...baseEntry, actor: null, actor_role: null }]}
        actionLabelMap={ACTION_LABEL}
        actionToneMap={ACTION_TONE}
        formatStatus={fmt}
        emptyLabel="empty"
        systemLabel="Sistem otomatis"
      />,
    );
    expect(html).toContain("Sistem otomatis");
    expect(html).not.toContain(">System<");
  });

  it("renders bullet fallback in avatar when actor has no name", () => {
    const html = renderToStaticMarkup(
      <ApprovalTimeline
        entries={[{ ...baseEntry, actor: { full_name: null }, actor_role: null }]}
        actionLabelMap={ACTION_LABEL}
        actionToneMap={ACTION_TONE}
        formatStatus={fmt}
        emptyLabel="empty"
      />,
    );
    // The bullet is rendered inside an aria-hidden div — check both.
    expect(html).toContain("•");
    expect(html).toContain('aria-hidden="true"');
  });

  it("uses caller-supplied formatStatus for unknown status values", () => {
    const html = renderToStaticMarkup(
      <ApprovalTimeline
        entries={[
          {
            ...baseEntry,
            from_status: "PARANORMAL",
            to_status: "SUBMITTED",
          },
        ]}
        actionLabelMap={ACTION_LABEL}
        actionToneMap={ACTION_TONE}
        formatStatus={fmt}
        emptyLabel="empty"
      />,
    );
    // fmt() returns the raw string when not in the label map — proves
    // the component doesn't silently swallow unknown statuses.
    expect(html).toContain("PARANORMAL");
  });

  it("omits the role suffix when actor_role is null", () => {
    const html = renderToStaticMarkup(
      <ApprovalTimeline
        entries={[{ ...baseEntry, actor_role: null }]}
        actionLabelMap={ACTION_LABEL}
        actionToneMap={ACTION_TONE}
        formatStatus={fmt}
        emptyLabel="empty"
      />,
    );
    // The `·` bullet is only rendered when actor_role has a value.
    expect(html).not.toContain("·");
  });
});
