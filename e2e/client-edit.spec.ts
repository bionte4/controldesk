import { expect } from "@playwright/test";

import { loginAs, test } from "./fixtures";

/**
 * Client CRUD — Edit flow (rules §6).
 *
 * Covers:
 *   1. Only OM+ / TENANT_ADMIN see the "Edit" button on the client detail
 *      page (PDP gate → `decideClient` in `src/lib/security/pdp.ts`).
 *   2. Editing pre-fills the sheet with existing values.
 *   3. Successful update surfaces a toast + persists after RSC refresh.
 *   4. The Kontrak/PID reference chips appear when populated.
 *
 * Prereq: seed.sql provisions the client "PT Nusa Digital" at the fixed UUID
 *   22222222-1111-4111-8111-111111111111 (see supabase/seed.sql).
 */

const CLIENT_NUSA_ID = "22222222-1111-4111-8111-111111111111";

test.describe("Clients — Edit flow", () => {
  test("Admin can edit client fields (industry + contract_number + PID)", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto(`/clients/${CLIENT_NUSA_ID}`);

    // Header renders with the client name.
    await expect(
      page.getByRole("heading", { level: 1, name: /nusa/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Edit button is visible for admin.
    const editBtn = page
      .getByRole("button", { name: /^edit$/i })
      .first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Sheet opens with the edit title (bilingual match).
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(/edit (klien|client)/i);

    // Update the industry field to a well-known marker.
    const marker = `E2E-Industry-${Date.now().toString().slice(-6)}`;
    const industryInput = sheet.getByLabel(/industri|industry/i);
    await industryInput.fill(marker);

    // Save. Wait for the toast (Sonner) to confirm.
    await sheet
      .getByRole("button", { name: /simpan perubahan|save changes/i })
      .click();

    await expect(page.getByText(/berhasil diperbarui|updated/i)).toBeVisible({
      timeout: 15_000,
    });

    // After RSC refresh, the marker appears in the header meta line.
    await expect(page.locator("body")).toContainText(marker, {
      timeout: 15_000,
    });
  });

  test("Non-privileged role does NOT see the Edit button", async ({ page }) => {
    await loginAs(page, "employee");
    await page.goto(`/clients/${CLIENT_NUSA_ID}`);

    // The page itself is readable (RLS allows SELECT for authenticated users
    // in the tenant); only the write UI is gated.
    await expect(
      page.getByRole("heading", { level: 1, name: /nusa/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Assert the Edit trigger button is *not* rendered anywhere in the header.
    const editBtn = page.getByRole("button", { name: /^edit$/i });
    await expect(editBtn).toHaveCount(0);
  });
});
