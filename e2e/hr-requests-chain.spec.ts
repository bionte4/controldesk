import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

/**
 * HR requests chain E2E (rules §12).
 *
 * Seeded rows in `supabase/seed.sql` §5:
 *   • HR-LEAVE (`55555555-…-111`): PENDING_L1_SUPERVISOR — full 4-step chain.
 *       Employee → Supervisor → PM → OM → HR Admin (final).
 *   • HR-OVERTIME (`55555555-…-222`): PENDING_L2_PROJECT_MANAGER — mid-chain.
 *   • HR-SICK (`55555555-…-333`): PENDING_HR_ADMIN — single-hop.
 *
 * We cover:
 *   1. SICK single-hop (fastest) — HR admin approves → APPROVED.
 *   2. OVERTIME mid-chain — PM → OM → HR admin.
 *   3. Denial: EMPLOYEE cannot approve their own request.
 *
 * The **full 4-hop LEAVE chain** (L1 → L2 → L3 → HR) lives in the
 * companion `hr-leave-chain.spec.ts` — Supervisor → PM → OM → HR admin.
 * Together these three suites exercise every state transition on the HR
 * side of the state machine.
 */

const SICK_ID = "55555555-1111-4111-8111-333333333333";
const OT_ID = "55555555-1111-4111-8111-222222222222";
const SICK_URL = `/hr/requests/${SICK_ID}`;
const OT_URL = `/hr/requests/${OT_ID}`;

async function approveOnDetailPage(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.getByRole("button", { name: /^(approve|setujui)$/i }).click();
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page
      .getByRole("button", { name: /confirm approve|konfirmasi setujui/i })
      .click(),
  ]);
}

test.describe.configure({ mode: "serial" });

test.describe("HR sick request — single-hop chain", () => {
  test("HR admin approves seeded SICK request", async ({ page }) => {
    await loginAs(page, "hr");
    await page.goto(SICK_URL);

    // Badge before action.
    await expect(
      page.getByText(/pending .* hr admin|pending.*hr/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await approveOnDetailPage(page);

    await expect(page.getByText(/^approved$|disetujui/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("HR overtime request — remaining chain", () => {
  test("PM approves L2 → L3 OM", async ({ page }) => {
    await loginAs(page, "pm");
    await page.goto(OT_URL);

    await expect(
      page.getByText(/pending .*l2 · project|pending l2/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await approveOnDetailPage(page);

    await expect(
      page.getByText(/pending .*l3 · operations|pending l3/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("OM approves L3 → HR Admin", async ({ page }) => {
    await loginAs(page, "om");
    await page.goto(OT_URL);

    await approveOnDetailPage(page);

    await expect(
      page.getByText(/pending .* hr admin|pending.*hr/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("HR admin finalises overtime → APPROVED", async ({ page }) => {
    await loginAs(page, "hr");
    await page.goto(OT_URL);

    await approveOnDetailPage(page);

    await expect(page.getByText(/^approved$|disetujui/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("HR requests access-control denials", () => {
  test("employee cannot see Approve/Reject on their own SICK request", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    // At the very least the requester can read their own request.
    await page.goto(SICK_URL);
    // But no approve/reject buttons rendered — only approvers see them.
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^(reject|tolak)$/i }),
    ).toHaveCount(0);
  });

  test("supervisor cannot approve a request already past L1", async ({
    page,
  }) => {
    // OT is at PENDING_L2 (or later after this suite runs) — Supervisor is
    // past their turn. Expect no approve button.
    await loginAs(page, "supervisor");
    await page.goto(OT_URL);
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
  });
});
