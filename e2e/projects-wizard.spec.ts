import { expect } from "@playwright/test";

import { loginAs, test } from "./fixtures";

/**
 * Project creation wizard E2E (rules §7 GAS-align + migration 0036).
 *
 * Covers:
 *   - 3-step wizard navigation (Info → Timeline & budget → Milestones)
 *   - Auto-generated project number (PRJ-YYYY-####) surfaced in the row
 *   - Priority + project_type + location captured on Step 1
 *   - Contract value + IDR currency on Step 2
 *   - Inline milestone add on Step 3
 *
 * Uses `data-testid` selectors on the Shadcn Select triggers because Base UI's
 * combobox role does not consistently expose the sibling FormLabel as its
 * accessible name.
 */

function stamp(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.describe("projects wizard", () => {
  // TODO(e2e): this happy-path submit is currently flakey against BaseUI's
  // Sheet primitive in Playwright — the Save click's synthetic submit event
  // does not consistently bubble into RHF's `handleSubmit`, even though the
  // exact same flow succeeds when driven by a real user. Wizard correctness
  // is covered by:
  //   - src/lib/validation/project.test.ts (Zod schema, 13 cases)
  //   - the second test below (Step 1 validation)
  //   - migration 0036 verification: the auto-number trigger produces
  //     `PRJ-YYYY-####` (proven via psql smoke insert)
  // Re-enable once we swap the Sheet primitive's submit boundary or move
  // to a hosted CI where the Sheet portal timing is more deterministic.
  test("admin creates a project via the 3-step wizard", async ({ page }) => {
    // Capture console errors + toast text so failures surface actionable
    // diagnostics instead of a bare 15-second toBeHidden timeout. Register
    // BEFORE any navigation so we see hydration errors, RHF validation
    // outputs, and server-action failures.
    const logs: string[] = [];
    page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

    await loginAs(page, "admin");
    await page.goto("/projects");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The `New project` CTA is disabled when the RSC render sees `clients.length === 0`.
    // Under Playwright's cold-cache scenario this can happen because the middleware
    // hasn't warmed the tenant header on the very first page hit. A single reload
    // is enough to re-render with the seeded client list.
    const newBtn = page.getByRole("button", { name: /new project|proyek baru/i });
    if (await newBtn.isDisabled()) {
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await expect(newBtn).toBeEnabled({ timeout: 15_000 });
    await newBtn.click();

    // ------- Step 1: Info -------
    const projectName = `E2E Wizard Project ${stamp()}`;
    await page.getByLabel(/project name|nama proyek/i).fill(projectName);

    // Client picker.
    await page.getByTestId("wizard-client").click();
    await page.getByRole("option").first().click();

    // Project type — Fixed Price.
    await page.getByTestId("wizard-project-type").click();
    await page.getByRole("option", { name: /fixed price/i }).click();

    // Priority — Critical (feeds default issue severity via §7 inheritance).
    await page.getByTestId("wizard-priority").click();
    await page.getByRole("option", { name: /critical|kritis/i }).click();

    // Location — free text.
    await page.getByLabel(/location|lokasi/i).fill("Jakarta HQ");

    // Advance to step 2.
    await page.getByRole("button", { name: /^next$|^lanjut$/i }).click();

    // ------- Step 2: Timeline & budget -------
    const today = new Date();
    const yyyy = today.getUTCFullYear();
    const start = today.toISOString().slice(0, 10);
    const endDate = new Date(today.getTime() + 30 * 86_400_000);
    const end = endDate.toISOString().slice(0, 10);

    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill(start);
    await dateInputs.nth(1).fill(end);

    await page
      .getByLabel(/contract value|nilai kontrak/i)
      .fill("500000000");

    await page.getByRole("button", { name: /^next$|^lanjut$/i }).click();

    // ------- Step 3: Milestones (optional at creation) -------
    // Empty state visible; milestones are optional so we skip the add flow
    // and submit right away — proves the wizard closes without milestones.
    await expect(
      page.getByText(/no milestones yet|belum ada milestone/i),
    ).toBeVisible();

    // Click Save. The dialog unmounts on successful submit; we assert the
    // unmount to avoid the click's own actionability retries racing that
    // teardown.
    const dialog = page.getByRole("dialog", { name: /new project|proyek baru/i });

    await dialog.getByTestId("wizard-submit").click();

    try {
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    } catch (e) {
      const toastText = await page
        .locator('[aria-label*="Notif"], [role="status"], [data-sonner-toast]')
        .allTextContents()
        .catch(() => []);
      throw new Error(
        `Dialog stayed visible after Save click.\nToast(s): ${JSON.stringify(toastText)}\nConsole:\n${logs.slice(-30).join("\n")}`,
      );
    }

    // Newly-created row lands in the list with the project name we passed.
    // The auto-generated project number is asserted via the KODE cell of
    // that same row (rules §7 GAS-align).
    const projectLink = page.getByRole("link", { name: projectName });
    await expect(projectLink).toBeVisible({ timeout: 15_000 });

    const row = projectLink.locator(
      "xpath=ancestor::tr[contains(@class, 'border-t')]",
    );
    await expect(row.locator("a").first()).toContainText(
      new RegExp(`^PRJ-${yyyy}-\\d{4}$`),
    );
  });

  test("wizard blocks advancing when required Step 1 fields are empty", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/projects");
    await page.getByRole("button", { name: /new project|proyek baru/i }).click();

    // Try to skip forward without filling anything.
    await page.getByRole("button", { name: /^next$|^lanjut$/i }).click();

    // Validation error surfaces on the required Project name field.
    await expect(page.getByText(/name is too short|too short|pendek/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});
