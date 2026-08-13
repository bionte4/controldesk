import { expect, test } from "@playwright/test";

test.describe("tenant entry page", () => {
  test("renders the tenant login hero + account CTA", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: /kendalikan proyek|control projects/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(masuk|sign in)$/i }),
    ).toBeVisible();
    const registerLink = page
      .getByRole("link", { name: /(buat akun|create account)/i })
      .first();
    await expect(registerLink).toBeVisible();
    await expect(registerLink).toHaveAttribute("href", "/register-org");
  });
});
