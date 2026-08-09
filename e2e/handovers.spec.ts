import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

// DEPRECATED per rules §13 (PM Handover module removed in Fase 0).
// The `/handovers` route + `pm_handovers` table are scheduled for
// drop in migration 0.4; the UI has already been unwired. Tests below
// therefore time out looking for a page that no longer renders. They
// remain here as an executable spec so we can re-enable them once a
// replacement flow (change-log + notify) lands — see migration plan
// docs/gas-migration-plan.md. Skip prevents CI red without deleting
// coverage intent.
test.describe.skip("PM handovers (deprecated per rules §13 — module removed)", () => {
  test("OM sees the seeded PENDING_OM handover", async ({ page }) => {
    await loginAs(page, "om");
    await page.goto("/handovers");
    // Table should include the Kirana pilot project seeded in
    // supabase/seed.sql section 8.
    await expect(page.getByText(/kira-da|kirana/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText(/pending.*operations manager|menunggu.*operations/i),
    ).toBeVisible();
  });

  test("employee cannot open /handovers", async ({ page }) => {
    await loginAs(page, "employee");
    await page.goto("/handovers");
    // Row-level protection: the page should still render, but the list is
    // empty for a non-approver + non-initiator. If PDP short-circuits with
    // 403, we accept that too.
    const url = page.url();
    if (url.includes("/handovers")) {
      // Either the empty state OR nav item hidden — accept either.
      const emptyMarker = page.getByText(
        /(no pm handovers|belum ada serah terima)/i,
      );
      await expect(emptyMarker).toBeVisible({ timeout: 10_000 });
    }
  });
});
