import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

/**
 * HR LEAVE full-chain E2E (rules §12).
 *
 * Seeded row (`supabase/seed.sql` §5):
 *   • HR-LEAVE (`55555555-1111-4111-8111-111111111111`) status
 *     `PENDING_L1_SUPERVISOR`, kind `LEAVE`, `leave_type = ANNUAL`,
 *     linked to `proj_nusa_cs_id` project.
 *
 * Chain walked (4 hops — the full LEAVE flow):
 *   1. Supervisor approves L1 → PENDING_L2_PROJECT_MANAGER.
 *   2. PM approves L2 → PENDING_L3_OPERATIONS_MANAGER.
 *   3. OM approves L3 → PENDING_HR_ADMIN.
 *   4. HR admin finalises → APPROVED.
 *
 * Denial coverage:
 *   • Employee (requester) sees the detail page but no approve button.
 *   • Finance is not in the LEAVE approver chain at any hop.
 *
 * SICK + OVERTIME suites already cover the individual approver roles on
 * other paths; this suite closes the "every LEAVE hop end-to-end" gap so
 * a regression in the L1→L2→L3→HR wiring is caught by the E2E harness.
 *
 * Serial — re-run requires `pnpm db:reset`.
 */

const LEAVE_ID = "55555555-1111-4111-8111-111111111111";
const LEAVE_URL = `/hr/requests/${LEAVE_ID}`;

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

// DEPRECATED per rules §12 — `hr_requests` LEAVE flow is superseded by
// the Timesheet module (§12). The 4-hop approval chain no longer has a
// UI to click through; migration to Timesheet notes covers the gap.
// Re-enable when a formal leave-request module lands (Fase 12+).
test.describe.skip("HR LEAVE — full 4-hop chain (deprecated per rules §12)", () => {
  test("Supervisor approves L1 → L2 PM", async ({ page }) => {
    await loginAs(page, "supervisor");
    await page.goto(LEAVE_URL);

    await expect(
      page.getByText(/pending .*l1 · supervisor|pending l1/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await approveOnDetailPage(page);

    await expect(
      page.getByText(/pending .*l2 · project|pending l2/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("PM approves L2 → L3 OM", async ({ page }) => {
    await loginAs(page, "pm");
    await page.goto(LEAVE_URL);

    await approveOnDetailPage(page);

    await expect(
      page.getByText(/pending .*l3 · operations|pending l3/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("OM approves L3 → HR Admin", async ({ page }) => {
    await loginAs(page, "om");
    await page.goto(LEAVE_URL);

    await approveOnDetailPage(page);

    await expect(
      page.getByText(/pending .* hr admin|pending.*hr/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("HR admin finalises LEAVE → APPROVED", async ({ page }) => {
    await loginAs(page, "hr");
    await page.goto(LEAVE_URL);

    await approveOnDetailPage(page);

    await expect(page.getByText(/^approved$|disetujui/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe.skip("HR LEAVE access-control denials (deprecated per rules §12)", () => {
  test("employee (requester) sees no approve button on their own LEAVE", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    await page.goto(LEAVE_URL);
    // Detail page still readable (rules §12 — self-service read is
    // always allowed), but the requester never appears in their own
    // approver chain, so the approve/reject buttons must not render.
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^(reject|tolak)$/i }),
    ).toHaveCount(0);
  });

  test("Lead Finance is not in the LEAVE approver chain", async ({ page }) => {
    // Finance sits on the Finance/expense side; the HR chain never
    // routes to LEAD_FINANCE at any hop. This asserts the guard is
    // status-independent — no approve affordance even after the chain
    // has moved past L2.
    await loginAs(page, "finance");
    await page.goto(LEAVE_URL);
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
  });
});
