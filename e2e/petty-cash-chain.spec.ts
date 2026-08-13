import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

/**
 * Petty cash replenishment chain E2E (rules §10).
 *
 * Seeded fund: `77777777-1111-4111-8111-111111111111`
 *   • Balance ~3.225.000 (imprest 5.000.000 minus 1.775.000 in vouchers).
 *   • min_balance 1.000.000.
 *   • Custodian: `pettycash@demo.controldesk.app`.
 *
 * Chain walked by this suite:
 *   1. Custodian opens fund detail → requests replenishment (PENDING_FINANCE).
 *   2. Lead Finance opens fund detail → approves (APPROVED).
 *   3. Lead Finance disburses with a bank ref (DISBURSED, balance restored).
 *
 * The suite is *serial* — like the CA chain, re-run requires `pnpm db:reset`.
 */

const FUND_ID = "77777777-1111-4111-8111-111111111111";
const FUND_URL = `/finance/petty-cash/${FUND_ID}`;

test.describe.configure({ mode: "serial" });

test.describe("petty cash replenishment chain", () => {
  test("custodian requests a replenishment", async ({ page }) => {
    await loginAs(page, "pettycash");
    await page.goto(FUND_URL);

    // Header should show the seeded location name.
    await expect(page.getByText(/jakarta hq/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Open the RequestReplenishmentDialog trigger.
    await page
      .getByRole("button", { name: /(request replenishment|ajukan (replenish|top-up))/i })
      .first()
      .click();

    // Fill amount (top-up to imprest ceiling ≈ 1.775.000) — 2.000.000 rounded.
    await page
      .getByLabel(/(amount|nominal)/i)
      .first()
      .fill("2000000");
    await page
      .getByLabel(/(reason|alasan)/i)
      .first()
      .fill("Top-up bulanan Q3 sesuai imprest ceiling.");

    // Submit confirm button (the last "Confirm" / "Kirim" inside the dialog).
    await page
      .getByRole("button", {
        name: /submit request|kirim pengajuan/i,
      })
      .click();

    // A PENDING_FINANCE badge should appear in the replenishments list.
    await expect(page.getByText("PENDING_FINANCE").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("finance approves the pending replenishment", async ({ page }) => {
    await loginAs(page, "finance");
    await page.goto(FUND_URL);

    await page
      .getByRole("button", { name: /^(approve|setujui)$/i })
      .first()
      .click();
    await page
      .getByRole("button", { name: /confirm approve|konfirmasi.*setujui/i })
      .click();

    await expect(page.getByText("APPROVED").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("finance disburses the approved replenishment", async ({ page }) => {
    await loginAs(page, "finance");
    await page.goto(FUND_URL);

    await page
      .getByRole("button", { name: /disburse|cairkan/i })
      .first()
      .click();

    await page
      .getByLabel(/(disbursement ref|referensi pencairan|nomor.*trx)/i)
      .fill("PC-E2E-TRX-001");

    await page
      .getByRole("button", { name: /confirm disburse|konfirmasi cairkan/i })
      .click();

    await expect(page.getByText("DISBURSED").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("petty cash access-control denials", () => {
  test("employee cannot see New voucher / request replenishment buttons", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    await page.goto(FUND_URL);
    // Detail page may render or 403 depending on PDP — either is acceptable.
    if (page.url().includes(FUND_ID)) {
      await expect(
        page.getByRole("button", { name: /new voucher|voucher baru/i }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: /request replenishment|ajukan (replenish|top-up)/i,
        }),
      ).toHaveCount(0);
    }
  });

  test("supervisor cannot approve a pending replenishment", async ({
    page,
  }) => {
    await loginAs(page, "supervisor");
    await page.goto(FUND_URL);
    // Only Lead Finance / TENANT_ADMIN see Approve on PENDING_FINANCE rows.
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
  });
});
