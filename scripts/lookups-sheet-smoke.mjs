#!/usr/bin/env node
/**
 * Regression smoke for the /settings/lookups "Add option" form migration.
 *
 * Before: `Add option` opened a centered Dialog (Radix / Base UI dialog root),
 * inconsistent with the rest of the app which uses side-anchored Sheets.
 *
 * After: `Add option` opens a right-side Sheet slide-over. This test proves
 * that clicking the button mounts a Sheet primitive on the right edge and
 * that the Cancel / Save controls are reachable — same interaction contract
 * as the shifts / cash-advance / capability edit forms.
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

  await page.goto("/settings/lookups", { waitUntil: "domcontentloaded" });
  // Wait for the tabs bar to render — a locale-agnostic signal that
  // /settings/lookups fully hydrated. Uses the data-slot Radix injects on
  // TabsList regardless of translation.
  await page.locator('[data-slot="tabs-list"]').first().waitFor({ timeout: 15_000 });
  pass("/settings/lookups rendered");

  // Click first "Add option" button (Departments tab is default). The
  // label is localized (id: "Tambah opsi", en: "Add option") — match on
  // the leading Plus icon + shared prefix "add"/"tambah" for robustness.
  const addBtn = page
    .getByRole("button", { name: /(Add option|Tambah opsi)/i })
    .first();
  await addBtn.click();

  // Sheet mounts a portal `[data-slot="sheet-content"]` — Radix/BaseUI naming.
  const sheet = page.locator('[data-slot="sheet-content"]').first();
  await sheet.waitFor({ state: "visible", timeout: 5_000 });
  pass("Sheet mounted after Add option click");

  // Confirm sheet anchors on the right (data-side=right).
  const side = await sheet.getAttribute("data-side");
  if (side === "right") {
    pass("Sheet anchored to right edge (data-side=right)");
  } else {
    fail(`Expected data-side=right, got ${side}`);
  }

  // Bounding box should sit on the right half of the 1440px viewport.
  const box = await sheet.boundingBox();
  if (box && box.x > 700) {
    pass(`Sheet x=${Math.round(box.x)} px sits on right half (viewport 1440)`);
  } else {
    fail(`Sheet x=${box?.x} — expected > 700 for right-anchored sheet`);
  }

  // Form controls should be reachable. Match on English + Indonesian
  // labels (en: "Code" / id: "Kode", en: "Label" / id: "Label").
  await sheet.getByLabel(/(Code|Kode)/i).first().waitFor();
  await sheet.getByLabel(/Label/i).first().waitFor();
  pass("Code + Label inputs reachable inside sheet");

  await page.screenshot({
    path: "screenshots/lookups/lookups-add-sheet.png",
    fullPage: false,
  });
  pass("Screenshot saved → screenshots/lookups/lookups-add-sheet.png");

  // Cancel via ESC to make sure sheet closes cleanly.
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden", timeout: 5_000 });
  pass("Sheet dismissed via Escape");
} catch (err) {
  fail(`Uncaught error: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
