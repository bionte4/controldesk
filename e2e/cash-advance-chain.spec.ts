import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

/**
 * Full CA lifecycle E2E (rules §11).
 *
 * Uses the demo tenant's seeded rows from supabase/seed.sql:
 *   • CA_PENDING (66666666-…-111): Rp 1.5jt, PENDING_L1_SUPERVISOR.
 *     Walked through Supervisor → PM → Finance → Disburse → SETTLED.
 *   • CA_DISBURSED (66666666-…-222): Rp 4.2jt, already DISBURSED.
 *     Employee submits settlement, Finance accepts → SETTLED.
 *
 * The chain suite runs **serial** because each step depends on the previous
 * transition. If you re-run the whole suite you MUST re-seed the database
 * (pnpm db:reset) — otherwise CA_PENDING will already be past L1.
 */

const CA_PENDING = "66666666-1111-4111-8111-111111111111";
const CA_DISBURSED = "66666666-1111-4111-8111-222222222222";

const CA_PENDING_URL = `/finance/cash-advances/${CA_PENDING}`;
const CA_DISBURSED_URL = `/finance/cash-advances/${CA_DISBURSED}`;

test.describe.configure({ mode: "serial" });

test.describe("cash advance approval chain", () => {
  test("supervisor approves L1", async ({ page }) => {
    await loginAs(page, "supervisor");
    await page.goto(CA_PENDING_URL);

    // Status badge should read "Pending L1 · Supervisor" (or Indonesian equiv).
    await expect(
      page.getByText(/pending .*l1|supervisor/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^(approve|setujui)$/i }).click();

    const confirmApprove = page.getByRole("button", {
      name: /confirm.*approve|konfirmasi.*setujui/i,
    });
    await expect(confirmApprove).toBeVisible();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      confirmApprove.click(),
    ]);

    await expect(
      page.getByText(/pending .*l2 · project manager|pending l2 · project/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("PM approves L2", async ({ page }) => {
    await loginAs(page, "pm");
    await page.goto(CA_PENDING_URL);

    await expect(
      page.getByText(/pending .*l2 · project/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^(approve|setujui)$/i }).click();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page
        .getByRole("button", { name: /confirm.*approve|konfirmasi.*setujui/i })
        .click(),
    ]);

    await expect(
      page.getByText(/pending .*l2\.5 · lead finance|pending l2\.5/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("finance approves L2.5 → APPROVED", async ({ page }) => {
    await loginAs(page, "finance");
    await page.goto(CA_PENDING_URL);

    await page.getByRole("button", { name: /^(approve|setujui)$/i }).click();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page
        .getByRole("button", { name: /confirm.*approve|konfirmasi.*setujui/i })
        .click(),
    ]);

    // Amount is Rp 1.5jt → threshold matrix skips L3+. Should land at APPROVED.
    await expect(
      page.getByText(/awaiting disbursement|menunggu pencairan|approved/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("finance disburses the approved CA", async ({ page }) => {
    await loginAs(page, "finance");
    await page.goto(CA_PENDING_URL);

    await page
      .getByRole("button", { name: /disburse|cairkan/i })
      .first()
      .click();

    // Fill disbursement ref then confirm.
    await page
      .getByLabel(/disbursement ref|referensi pencairan|nomor.*trx/i)
      .fill("E2E-TRX-001");
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page
        .getByRole("button", { name: /confirm disburse|konfirmasi cairkan/i })
        .click(),
    ]);

    await expect(
      page.getByText(/disbursed .* awaiting settlement|dicairkan/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("cash advance settlement chain", () => {
  test.describe.configure({ mode: "serial" });

  test("employee submits settlement on CA-2 (seeded DISBURSED)", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    await page.goto(CA_DISBURSED_URL);

    // "Submit settlement" button visible for requester on DISBURSED CA.
    await page
      .getByRole("button", { name: /submit settlement|kirim settlement/i })
      .click();

    // Total spent 4jt (200k refund).
    await page
      .getByLabel(/total spent|total terpakai/i)
      .fill("4000000");
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page
        .getByRole("button", { name: /^(submit|kirim)$/i })
        .last()
        .click(),
    ]);

    // A settlement row with status SUBMITTED should appear.
    await expect(page.getByText("SUBMITTED").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("finance accepts the submitted settlement → SETTLED", async ({
    page,
  }) => {
    await loginAs(page, "finance");
    await page.goto(CA_DISBURSED_URL);

    // Review buttons appear beside the SUBMITTED settlement row.
    await page
      .getByRole("button", { name: /^(accept|terima)$/i })
      .first()
      .click();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page
        .getByRole("button", { name: /confirm accept|konfirmasi terima/i })
        .click(),
    ]);

    // CA status badge should now read Settled.
    await expect(
      page.getByText(/^settled$|selesai/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("cash advance access-control denials", () => {
  test("employee cannot see Approve / Disburse buttons on PENDING CA", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    await page.goto(CA_PENDING_URL);
    // Detail page renders (requester can read own CA) but action buttons stay hidden.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /disburse|cairkan/i }),
    ).toHaveCount(0);
  });

  test("supervisor cannot disburse an approved CA", async ({ page }) => {
    await loginAs(page, "supervisor");
    await page.goto(CA_PENDING_URL);
    // Supervisor sees the page but never gets a Disburse button — only Finance does.
    await expect(
      page.getByRole("button", { name: /disburse|cairkan/i }),
    ).toHaveCount(0);
  });
});
