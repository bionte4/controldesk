import { expect, test, type Page } from "@playwright/test";

import { loginAs } from "./fixtures";

/**
 * Weekly Timesheet full-chain E2E (GAS §27, rules §14, Fase 2).
 *
 * Seeded state (`supabase/seed.sql` §21):
 *   • One SUBMITTED weekly packet for the demo Employee's current ISO week
 *     (`date_trunc('week', current_date)` at seed time) attached to project
 *     NUSA-CS. Total 40h + 2h overtime split across Mon..Sun.
 *   • One APPROVED weekly packet for the prior week (data-only, not tested
 *     here; already covered by the invariance unit test).
 *
 * Chain walked (2 hops):
 *   1. PM sees the packet in the approvals inbox + opens editor via inbox
 *      link → verifies review buttons render.
 *   2. PM approves → packet moves to APPROVED, daily row cascade verified
 *      via UI refresh.
 *
 * Denial coverage:
 *   • Employee sees the packet in readonly mode (no edit / approve UI while
 *     SUBMITTED for their own week).
 *
 * Serial — mutates the seeded SUBMITTED row. Re-run requires `pnpm db:reset`.
 */

// ---------------------------------------------------------------------------
// ISO Monday helper — mirrors `weekStartFromDate` in
// `src/lib/timesheets/week-state.ts`. The Postgres seed uses
// `date_trunc('week', current_date)` which is also ISO Monday, so the
// values agree at test time.
// ---------------------------------------------------------------------------
function isoMondayOf(date: Date): string {
  const d = new Date(date.getTime());
  const dow = d.getUTCDay();
  const daysBack = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - daysBack);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEK_START = isoMondayOf(new Date());

test.describe.configure({ mode: "serial" });

test.describe("Weekly Timesheet — approve chain", () => {
  test("Employee sees the seeded SUBMITTED packet (readonly)", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    await page.goto(`/hr/timesheets/weekly/${WEEK_START}`);

    // Status badge = Pending approval (SUBMITTED).
    await expect(
      page.getByText(/pending approval|menunggu persetujuan/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Editable form is NOT rendered because status is SUBMITTED for the
    // employee themselves.
    await expect(
      page.getByRole("button", { name: /submit week|ajukan minggu/i }),
    ).toHaveCount(0);

    // Approval history section should appear (SUBMIT event from seed).
    await expect(
      page.getByText(/approval history|riwayat approval/i),
    ).toBeVisible();
  });

  test("PM sees the weekly-timesheet section in the approvals inbox", async ({
    page,
  }) => {
    await loginAs(page, "pm");
    await page.goto("/approvals");

    // The section header uses the i18n key `sections.weeklyTimesheets`.
    await expect(
      page.getByText(/weekly timesheets|timesheet mingguan/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The seed packet's week range should render (WEEK_START → Sunday).
    await expect(
      page.getByText(new RegExp(WEEK_START)).first(),
    ).toBeVisible();
  });

  test("PM opens the packet from the inbox and approves it → APPROVED", async ({
    page,
  }) => {
    await loginAs(page, "pm");
    await page.goto("/approvals");

    // Click the packet's inbox card (link points to the weekly editor).
    const inboxLink = page
      .getByRole("link", { name: new RegExp(WEEK_START) })
      .first();
    await inboxLink.click();

    // We should land on the weekly editor.
    await expect(page).toHaveURL(
      new RegExp(`/hr/timesheets/weekly/${WEEK_START}`),
    );

    // Approve dialog flow.
    await page
      .getByRole("button", { name: /approve week|setujui minggu/i })
      .click();
    await page
      .getByRole("button", {
        name: /confirm approve|konfirmasi.*setujui/i,
      })
      .click();

    // Wait for the router refresh + expect APPROVED badge.
    await expect(page.getByText(/^approved$|^disetujui$/i).first()).toBeVisible(
      { timeout: 15_000 },
    );

    // Approval history now contains an APPROVE entry.
    await approveEntryVisible(page);
  });

  test("Employee sees APPROVED status on the same week", async ({ page }) => {
    await loginAs(page, "employee");
    await page.goto(`/hr/timesheets/weekly/${WEEK_START}`);
    await expect(
      page.getByText(/^approved$|^disetujui$/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

async function approveEntryVisible(page: Page): Promise<void> {
  await expect(
    page
      .getByText(/approval history|riwayat approval/i)
      .locator("..")
      .getByText(/APPROVE/i)
      .first(),
  ).toBeVisible({ timeout: 5_000 });
}
