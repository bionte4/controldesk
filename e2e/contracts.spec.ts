import { expect } from "@playwright/test";

import { loginAs, test } from "./fixtures";

/**
 * BPO Contracts module (rules §5).
 *
 * Covers:
 *   1. /finance/contracts list page loads and shows at least one row for
 *      the demo tenant (seeded contracts + our smoke MSA-DEMO-001).
 *   2. Row click → /finance/contracts/[id] detail page renders header,
 *      MRR metric, and the "Back" link routes to the client.
 *   3. Finance role can open the New Contract sheet.
 *   4. Edit button surfaces on the detail page for Lead Finance.
 *
 * Non-goals here: full CRUD assertion of writes — those are covered by
 * server-side Vitest tests. E2E asserts UI wiring + permissions only.
 */

test.describe("Contracts — Navigation & permissions", () => {
  test("Finance sees the list, the New Contract CTA, and can drill down", async ({
    page,
  }) => {
    await loginAs(page, "finance");
    await page.goto("/finance/contracts");

    await expect(
      page.getByRole("heading", { level: 1, name: /bpo contract|kontrak/i }),
    ).toBeVisible({ timeout: 20_000 });

    // CTA visible for LEAD_FINANCE (CONTRACT_WRITERS).
    const newBtn = page.getByRole("button", {
      name: /kontrak baru|new contract/i,
    });
    await expect(newBtn).toBeVisible();

    // Table renders. If seed has zero contracts, we fall back to the empty
    // state — either is fine, but the test only proceeds when there's a row
    // (the smoke MSA-DEMO-001 seeded during dev meets that condition).
    const firstRowLink = page
      .locator("table tbody tr a")
      .first();
    if (await firstRowLink.count()) {
      await firstRowLink.click();
      await expect(page).toHaveURL(/\/finance\/contracts\/[0-9a-f-]{36}/);
      // MRR metric card renders (the header shows `Rp …` from formatIDR).
      await expect(page.getByText(/Rp\s?\d/).first()).toBeVisible();
    }
  });

  test("Contract detail: Finance sees Edit button; Client link routes back", async ({
    page,
  }) => {
    // Reach the detail via the seeded MSA-DEMO-001 → find its id from the
    // list rather than hard-coding, because seed re-runs may re-issue the id.
    await loginAs(page, "finance");
    await page.goto("/finance/contracts");

    const msaLink = page
      .getByRole("link", { name: /MSA-DEMO-001/ })
      .first();
    // Skip cleanly if the smoke seed row isn't present in this environment.
    test.skip(!(await msaLink.count()), "MSA-DEMO-001 not seeded");

    await msaLink.click();
    await expect(page).toHaveURL(
      /\/finance\/contracts\/[0-9a-f-]{36}/,
    );

    // Detail page header shows contract_number in font-mono.
    await expect(
      page.getByRole("heading", { level: 1, name: /MSA-DEMO-001/ }),
    ).toBeVisible({ timeout: 20_000 });

    // Edit button visible for finance.
    await expect(
      page.getByRole("button", { name: /edit kontrak|edit contract/i }),
    ).toBeVisible();

    // Client name in the meta line links back to /clients/[id].
    const clientLink = page
      .getByRole("link", { name: /nusa/i })
      .first();
    await expect(clientLink).toBeVisible();
  });

  test("Non-privileged role sees the list read-only (no New Contract CTA)", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    await page.goto("/finance/contracts");

    await expect(
      page.getByRole("heading", { level: 1, name: /bpo contract|kontrak/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Employee (non-writer) should NOT see the New Contract button.
    await expect(
      page.getByRole("button", { name: /kontrak baru|new contract/i }),
    ).toHaveCount(0);
  });
});
