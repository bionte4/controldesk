import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

/**
 * PM Handover lifecycle E2E (rules §13).
 *
 * Seeded row (`supabase/seed.sql` §8):
 *   • Handover `88888888-1111-4111-8111-111111111111` on Kirana pilot
 *     (`33333333-1111-4111-8111-444444444444`) transferring PRIMARY_PM
 *     from Putri PM → Prima PM2. Status starts at PENDING_OM.
 *
 * Chain walked by this suite:
 *   1. OM approves L1 → PENDING_HM.
 *   2. HM approves L2 → APPROVED (awaiting execution).
 *   3. OM executes → EXECUTED. The `finalise_pm_handover` SQL function
 *      atomically flips the ACTIVE PRIMARY_PM row on
 *      `project_pm_assignments`.
 *   4. Verify the project detail page now shows Prima PM2 as Primary PM.
 *
 * Serial — re-run requires `pnpm db:reset`.
 */

const HANDOVER_ID = "88888888-1111-4111-8111-111111111111";
const HANDOVER_URL = `/handovers/${HANDOVER_ID}`;
const PROJECT_ID = "33333333-1111-4111-8111-444444444444";
const PROJECT_URL = `/projects/${PROJECT_ID}`;

const NEW_PM_NAME = "Prima PM2";
const OLD_PM_NAME = "Putri PM";

test.describe.configure({ mode: "serial" });

test.describe("PM handover lifecycle", () => {
  test("OM approves L1 → PENDING_HM", async ({ page }) => {
    await loginAs(page, "om");
    await page.goto(HANDOVER_URL);

    // Status pill on the header shows the localized PENDING_OM label.
    await expect(
      page
        .getByText(/pending .* operations manager|pending.*operations/i)
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^(approve|setujui)$/i }).click();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page
        .getByRole("button", { name: /confirm approve|konfirmasi.*setujui/i })
        .click(),
    ]);

    await expect(
      page.getByText(/pending .* head manager|pending.*head/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("HM approves L2 → APPROVED", async ({ page }) => {
    await loginAs(page, "hm");
    await page.goto(HANDOVER_URL);

    await page.getByRole("button", { name: /^(approve|setujui)$/i }).click();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page
        .getByRole("button", { name: /confirm approve|konfirmasi.*setujui/i })
        .click(),
    ]);

    await expect(
      page
        .getByText(
          /approved(?: .* awaiting execution)?|awaiting.*execution|disetujui/i,
        )
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("OM executes → EXECUTED (project PM swap)", async ({ page }) => {
    await loginAs(page, "om");
    await page.goto(HANDOVER_URL);

    // Execute button appears only on APPROVED for OM/HM/GM/TENANT_ADMIN.
    await page.getByRole("button", { name: /execute|eksekusi/i }).click();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page
        .getByRole("button", { name: /confirm execute|konfirmasi eksekusi/i })
        .click(),
    ]);

    await expect(page.getByText(/^executed$|selesai/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("project detail reflects new Primary PM after execution", async ({
    page,
  }) => {
    await loginAs(page, "om");
    await page.goto(PROJECT_URL);

    // "Primary PM" card should now list Prima PM2, not Putri PM.
    await expect(page.getByText(NEW_PM_NAME).first()).toBeVisible({
      timeout: 10_000,
    });

    // Sanity: the Primary PM card holding Prima PM2 must not simultaneously
    // show Putri as ACTIVE. We check by scoping to the card that contains
    // NEW_PM_NAME and asserting OLD_PM_NAME is absent from it. Putri may
    // still appear elsewhere on the page (e.g. audit log), which is fine.
    const primaryCard = page
      .locator("main, section, article, div")
      .filter({ hasText: NEW_PM_NAME })
      .first();
    await expect(primaryCard.getByText(OLD_PM_NAME)).toHaveCount(0);
  });
});

test.describe("PM handover access-control denials", () => {
  test("employee cannot see the pending handover in /handovers", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    await page.goto("/handovers");
    // Empty state or hidden nav — the fixture in `handovers.spec.ts`
    // already asserts the exact copy; here we simply assert there is no
    // approve/reject/execute affordance rendered for an employee.
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /execute|eksekusi/i }),
    ).toHaveCount(0);
  });

  test("PM cannot self-approve their own handover", async ({ page }) => {
    // Chain is already executed by earlier tests, but the guard is
    // status-independent — the PM role is never in the approver set for
    // PMH regardless of state. Detail page may 403 or render the row
    // without action buttons.
    await loginAs(page, "pm");
    await page.goto(HANDOVER_URL);
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
  });
});
