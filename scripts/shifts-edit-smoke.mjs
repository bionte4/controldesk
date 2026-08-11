#!/usr/bin/env node
/**
 * Regression smoke for the shifts row-action Edit sheet — proves that
 * clicking "Edit" in the dropdown actually opens the upsert Sheet
 * (rather than closing the menu with nothing visible).
 *
 * Reproduces the Base UI Menu → Dialog race that was fixed by adding
 * `event.preventDefault()` inside the `onSelect` handlers. Without the
 * fix, the Sheet mounts and is immediately dismissed by the menu's
 * outside-click detector in the same tick.
 */
import { chromium } from "@playwright/test";

const BASE = "http://demo.localhost:3001";
const EMAIL = "admin@demo.controldesk.app";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 20_000;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
});

let failures = 0;
const pass = (msg) => console.log("  ✓", msg);
const fail = (msg) => {
  failures += 1;
  console.error("  ✗", msg);
};

try {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[type="submit"]');
    return btn && !btn.disabled;
  });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: NAV_TIMEOUT }),
    page.click('button[type="submit"]'),
  ]);
  pass("Login as TENANT_ADMIN OK");

  const resp = await page.goto("/hr/shifts", {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT,
  });
  if (!resp || resp.status() !== 200) {
    fail(`/hr/shifts status ${resp?.status()}`);
    throw new Error("bail");
  }
  pass("/hr/shifts reachable (200)");

  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});

  const trigger = page.locator('button[aria-label="Row actions"]').first();
  await trigger.waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  await trigger.click();

  const menu = page.locator('[data-slot="dropdown-menu-content"]').first();
  await menu.waitFor({ state: "visible", timeout: 5000 });
  pass("Row-action menu opened");

  // Locale-agnostic: Edit is the first item, Delete is the second.
  // Label may be "Edit" (en) or "Ubah" (id).
  const items = page.locator('[data-slot="dropdown-menu-item"]');
  const itemTexts = await items.allTextContents();
  console.log(`    (dropdown items: ${JSON.stringify(itemTexts)})`);
  const editItem = items.first();
  await editItem.waitFor({ state: "visible", timeout: 5000 });
  await editItem.click();

  const sheet = page.locator('[data-slot="sheet-content"]');
  try {
    await sheet.waitFor({ state: "visible", timeout: 5000 });
    pass("Edit sheet opened after clicking menu item");
  } catch {
    fail("Edit sheet did NOT open — regression detected");
    await page.screenshot({ path: "/tmp/shifts-edit-fail.png", fullPage: true });
    console.log("    screenshot: /tmp/shifts-edit-fail.png");
  }

  const title = await sheet.locator('[data-slot="sheet-title"]').textContent().catch(() => null);
  if (title && title.trim().length > 0) pass(`Sheet title: "${title.trim().slice(0, 60)}"`);
  else fail("Sheet has no title text");

  // Sanity: the sheet is pre-populated with the row's code (Edit mode).
  const codeVal = await page.locator('input#code').first().inputValue().catch(() => "");
  if (codeVal && codeVal.length > 0) pass(`Code prefilled: "${codeVal}"`);
  else fail("Code input not prefilled");
} catch (err) {
  if (err instanceof Error && err.message !== "bail") {
    fail(`Uncaught: ${err.stack || err.message}`);
  }
} finally {
  if (consoleErrors.length) {
    console.log("\n  Browser console errors (informational):");
    consoleErrors.slice(0, 10).forEach((e) => console.log("   ·", e));
  }
  await browser.close();
}

if (failures > 0) {
  console.error(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`\n✓ Shifts edit-sheet smoke test passed against ${BASE}/hr/shifts`);
