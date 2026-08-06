import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

test.describe("approvals inbox", () => {
  test("supervisor sees the unified approvals inbox", async ({ page }) => {
    await loginAs(page, "supervisor");
    await page.goto("/approvals");
    // Header uses role kicker "Inbox".
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
    // Body should not be a 404.
    await expect(
      page.getByText(/approv|approval/i).first(),
    ).toBeVisible();
  });

  test("employee sees the 'not an approver' empty state", async ({ page }) => {
    await loginAs(page, "employee");
    await page.goto("/approvals");
    // Employee role is not in the approver set (§9); we render an empty
    // state with role-specific copy.
    await expect(
      page.getByText(
        /(role .* isn't an approver|peran .* bukan approver|approvals inbox is empty|inbox kosong)/i,
      ),
    ).toBeVisible({ timeout: 10_000 });
  });
});
