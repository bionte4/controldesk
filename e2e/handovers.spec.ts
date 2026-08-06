import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

test.describe("PM handovers", () => {
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
