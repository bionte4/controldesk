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

  test("Chain preview reflects Type + Amount selection", async ({ page }) => {
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

    // Switch to FIELD_OPS → chain becomes [SUPERVISOR, FINANCE].
    await page.getByLabel(/^(field ops|operasional lapangan)$/i).check();
    await expect(preview.getByText(/^supervisor$/i)).toBeVisible();
    await expect(preview.getByText(/^finance$/i)).toBeVisible();

    // Bump amount above 5M → FIELD_OPS adds PM.
    await page.getByLabel(/^(amount|nominal)/i).fill("6000000");
    await expect(preview.getByText(/^project manager$/i)).toBeVisible();
  });

  test(
    "Supervisor submits a FIELD_OPS cash advance and it appears on the list",
    async ({ page }) => {
      await loginAs(page, "supervisor");
      await page.goto("/finance/cash-advances");

      await page
        .getByRole("button", { name: /^(new request|kas bon baru)$/i })
        .click();

      // Type = FIELD_OPS.
      await page.getByLabel(/^(field ops|operasional lapangan)$/i).check();

      // First project in the select (any active project the supervisor is
      // assigned to). We pick by opening the trigger and grabbing the first
      // option — this avoids hard-coding project ids.
      await page.getByLabel(/^(project|proyek)$/i).click();
      await page.getByRole("option").first().click();

      const uniqueLabel = `E2E FIELD_OPS ${Date.now()}`;
      await page.getByLabel(/^(amount|nominal)/i).fill("750000");
      await page
        .getByLabel(/^(purpose|tujuan penggunaan)/i)
        .fill(uniqueLabel);

      await Promise.all([
        page.waitForLoadState("networkidle"),
        page
          .getByRole("button", { name: /submit for approval|kirim untuk approval/i })
          .click(),
      ]);

      // A new row bearing our uniqueLabel should be visible with the
      // FIELD_OPS badge nearby. We use a broad text match to avoid
      // depending on table cell order.
      await expect(page.getByText(uniqueLabel)).toBeVisible({
        timeout: 10_000,
      });
      const row = page.locator("tr", { hasText: uniqueLabel });
      await expect(
        row.getByText(/field ops|operasional lapangan/i),
      ).toBeVisible();
      // Canonical PENDING_SUPERVISOR label (Supervisor initiated field-ops
      // row always starts at the Supervisor rung — rules §9.4).
      await expect(
        row.getByText(/pending .*supervisor|menunggu .*supervisor/i),
      ).toBeVisible();
    },
  );
});
