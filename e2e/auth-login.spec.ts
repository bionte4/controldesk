import { expect, test } from "@playwright/test";

import { DEMO_PASSWORD, DEMO_USERS, loginAs } from "./fixtures";

test.describe("auth — login", () => {
  test("supervisor can log in and lands on /dashboard", async ({ page }) => {
    await loginAs(page, "supervisor");
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
    // The dashboard greets the user by first name; the compact topbar only
    // renders initials at desktop widths.
    await expect(
      page.getByRole("heading", { name: /sinta/i }),
    ).toBeVisible();
  });

  test("wrong password shows an error and keeps user on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .locator('input[type="email"]')
      .first()
      .fill(DEMO_USERS.employee.email);
    await page
      .locator('input[type="password"]')
      .first()
      .fill("wrong-password-xyz");
    await page
      .getByRole("button", { name: /^(sign in|masuk)$/i })
      .click();
    // We should stay on /login.
    await expect(page).toHaveURL(/\/login/);
    // Alert should appear (rules §23 uses role="alert" via Alert component).
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  });

  // The password constant is here so devs are reminded seed uses a fixed
  // password — DO NOT reuse this pattern outside seed.sql (rules §22).
  test.beforeEach(() => {
    test.info().annotations.push({
      type: "seed-password",
      description: `Seeded via supabase/seed.sql: ${DEMO_PASSWORD}`,
    });
  });
});
