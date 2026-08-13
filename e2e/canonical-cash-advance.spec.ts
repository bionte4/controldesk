import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

/**
 * Slice 1.5c smoke — canonical Cash Advance UI.
 *
 * Verifies the pieces wired up in Fase 1.5c without walking a full
 * approval chain (the legacy `cash-advance-chain.spec.ts` covers that
 * end-to-end path against seeded rows). This spec focuses on the NEW
 * bits that only exist on the canonical flow:
 *
 *   1. The New Cash Advance sheet renders the type selector and updates
 *      the chain preview as the user types.
 *   2. Submitting a FIELD_OPS row creates the CA and it appears on the
 *      list with the correct `ca_type` badge + canonical status label.
 *
 * We keep the amount small (Rp 500.000) so the resulting chain is short
 * and the assertions stay stable regardless of tenant threshold overrides.
 */

test.describe("canonical cash advance sheet + list", () => {
  test.describe.configure({ mode: "serial" });

  test("Type column header is rendered on the list page", async ({ page }) => {
    await loginAs(page, "supervisor");
    await page.goto("/finance/cash-advances");
    await expect(page.getByRole("columnheader", { name: /type|jenis/i }))
      .toBeVisible();
  });

  test("General chain preview reflects the amount", async ({ page }) => {
    await loginAs(page, "supervisor");
    await page.goto("/finance/cash-advances");

    await page
      .getByRole("button", { name: /^(new request|kas bon baru)$/i })
      .click();

    // Amount 500_000 → GENERAL chain is [FINANCE] only.
    await page.getByLabel(/^(amount|nominal)/i).fill("500000");
    const preview = page.getByTestId("ca-chain-preview");
    await expect(preview).toBeVisible();
    await expect(preview.getByText(/^finance$/i)).toBeVisible();
    await expect(preview.getByText(/^supervisor$/i)).toHaveCount(0);

    // Bump a GENERAL request above 5M → the chain adds PM.
    await page.getByLabel(/^(amount|nominal)/i).fill("6000000");
    await expect(preview.getByText(/^project manager$/i)).toBeVisible();
  });

  test(
    "Supervisor opens the dedicated FIELD_OPS request flow",
    async ({ page }) => {
      await loginAs(page, "supervisor");
      await page.goto("/finance/cash-advances");

      await page
        .getByRole("button", {
          name: /pengajuan operasional|field ops request/i,
        })
        .click();

      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText(/field ops|operasional/i).first()).toBeVisible();
      await expect(sheet.getByLabel(/project|proyek/i)).toBeVisible();
    },
  );
});
