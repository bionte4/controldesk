import { expect, test } from "@playwright/test";

test.describe("public landing page", () => {
  test("renders the marketing hero + primary CTAs", async ({ page }) => {
    await page.goto("/");
    // Hero should mention Managed Services (default id-ID locale).
    await expect(
      page.getByRole("heading", { name: /managed services/i }),
    ).toBeVisible();
    // Primary CTA links to /register — tenant provisioning entry point.
    const registerLink = page
      .getByRole("link", { name: /(buat ruang kerja|create workspace)/i })
      .first();
    await expect(registerLink).toBeVisible();
    // Secondary CTA takes you to /login.
    const loginLink = page
      .getByRole("link", { name: /(masuk|sign in)/i })
      .first();
    await expect(loginLink).toBeVisible();
  });
});
