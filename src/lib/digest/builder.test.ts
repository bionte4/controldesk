import { describe, expect, it } from "vitest";

import {
  APPROVAL_AGE_THRESHOLD_HOURS,
  computeHoursPending,
  filterApprovalsForAudience,
  renderDigestHtml,
  renderDigestSubject,
  renderDigestText,
  shouldSendDigest,
  type DigestBundle,
  type PendingApproval,
} from "./builder";

const now = new Date("2026-08-05T00:00:00Z");

function approval(
  kind: PendingApproval["kind"],
  hours: number,
  overrides: Partial<PendingApproval> = {},
): PendingApproval {
  return {
    id: `id-${kind}-${hours}`,
    kind,
    reference: `${kind} ref`,
    submitted_by: "Alice",
    submitted_at: new Date(now.getTime() - hours * 3600_000).toISOString(),
    hours_pending: hours,
    ...overrides,
  };
}

function bundle(overrides: Partial<DigestBundle> = {}): DigestBundle {
  return {
    tenant_id: "t1",
    tenant_name: "Demo Co",
    role_audience: "OPERATIONS",
    generated_at: now.toISOString(),
    pending_approvals: [],
    petty_cash_low_funds: [],
    sla_breach_risks: [],
    ...overrides,
  };
}

describe("digest builder", () => {
  it("computes hours pending", () => {
    const submitted = new Date(now.getTime() - 5 * 3600_000).toISOString();
    expect(computeHoursPending(submitted, now)).toBeCloseTo(5, 5);
  });

  it("returns 0 for invalid ISO", () => {
    expect(computeHoursPending("not-a-date", now)).toBe(0);
  });

  it("filters approvals older than 24h", () => {
    const items = [
      approval("EXPENSE", 30),
      approval("EXPENSE", 10),
      approval("CASH_ADVANCE", 48),
    ];
    const kept = filterApprovalsForAudience(items, "LEAD_FINANCE");
    expect(kept).toHaveLength(2);
    expect(kept.every((k) => k.hours_pending >= APPROVAL_AGE_THRESHOLD_HOURS)).toBe(true);
  });

  it("routes HR requests to HR audience only", () => {
    const items = [
      approval("HR_REQUEST", 48),
      approval("EXPENSE", 48),
      approval("CASH_ADVANCE", 48),
    ];
    expect(filterApprovalsForAudience(items, "HR_ADMIN")).toHaveLength(1);
    expect(filterApprovalsForAudience(items, "HR_ADMIN")[0].kind).toBe("HR_REQUEST");
  });

  it("routes finance items to LEAD_FINANCE only", () => {
    const items = [
      approval("HR_REQUEST", 48),
      approval("EXPENSE", 48),
      approval("PETTY_CASH_REPLENISHMENT", 48),
    ];
    const finance = filterApprovalsForAudience(items, "LEAD_FINANCE");
    expect(finance).toHaveLength(2);
    expect(finance.map((k) => k.kind).sort()).toEqual([
      "EXPENSE",
      "PETTY_CASH_REPLENISHMENT",
    ]);
  });

  it("shouldSendDigest is false when empty", () => {
    expect(shouldSendDigest(bundle())).toBe(false);
  });

  it("shouldSendDigest is true if any section has items", () => {
    expect(
      shouldSendDigest(
        bundle({ pending_approvals: [approval("EXPENSE", 48)] }),
      ),
    ).toBe(true);
    expect(
      shouldSendDigest(
        bundle({
          petty_cash_low_funds: [
            {
              fund_name: "Cabang Sudirman",
              location: null,
              balance_idr: 500_000,
              min_threshold_idr: 1_000_000,
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      shouldSendDigest(
        bundle({
          sla_breach_risks: [
            {
              project_code: "NUSA-CS",
              breach_within_hours: 18,
              breach_probability: 0.65,
              contributing_factors: ["A"],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("renders subject / text / html with tenant name", () => {
    const b = bundle({
      pending_approvals: [approval("EXPENSE", 48)],
      petty_cash_low_funds: [
        {
          fund_name: "Cabang Bogor",
          location: "Bogor",
          balance_idr: 500_000,
          min_threshold_idr: 1_500_000,
        },
      ],
      sla_breach_risks: [
        {
          project_code: "INDO-HELP",
          breach_within_hours: 12,
          breach_probability: 0.75,
          contributing_factors: ["backlog", "AHT rising"],
        },
      ],
    });

    const subject = renderDigestSubject(b);
    expect(subject).toContain("Demo Co");

    const text = renderDigestText(b);
    expect(text).toContain("Approval menunggu >24 jam");
    expect(text).toContain("Cabang Bogor");
    expect(text).toContain("INDO-HELP");

    const html = renderDigestHtml(b);
    expect(html).toContain("<html");
    expect(html).toContain("Demo Co");
    expect(html).toContain("Cabang Bogor");
  });

  it("escapes HTML in tenant / labels", () => {
    const b = bundle({ tenant_name: "<script>alert(1)</script>" });
    const html = renderDigestHtml(b);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});
