#!/usr/bin/env node
/**
 * Quick smoke — verifies /super-admin routing after the root redirect
 * page was added. Not part of the regular smoke suite, just useful
 * for manual reruns while iterating on the platform-admin surface.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = "admin@demo.controldesk.app";
const PASSWORD = "ControlDesk#2026";

async function login(page) {
  // Sign in on APEX host — platform admin surface is served there.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return btn && !btn.disabled;
    },
    { timeout: 30_000 },
  );
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/(dashboard|super-admin)/, { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let failures = 0;

  try {
    await login(page);
    console.log(`[1] logged in as ${EMAIL}, landed on ${page.url()}`);

    // Bare /super-admin — should redirect to /super-admin/tenants.
    await page.goto(`${BASE}/super-admin`, { waitUntil: "domcontentloaded" });
    const url = page.url();
    if (url.endsWith("/super-admin/tenants")) {
      console.log(`[2] ✓ /super-admin → ${url}`);
    } else {
      console.error(`[2] ✗ /super-admin resolved to ${url}, expected .../tenants`);
      failures += 1;
    }

    // Sanity: tenants page renders and contains at least the seeded demo row.
    const hasDemo = await page
      .getByText(/ControlDesk Demo BPO|demo\b/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (hasDemo) {
      console.log(`[3] ✓ demo tenant row visible on /super-admin/tenants`);
    } else {
      console.error(`[3] ✗ tenants list did not render a demo row`);
      failures += 1;
    }

    // New-tenant form reachable.
    await page.goto(`${BASE}/super-admin/tenants/new`, { waitUntil: "domcontentloaded" });
    const formVisible = await page
      .locator("form")
      .first()
      .isVisible()
      .catch(() => false);
    if (formVisible) {
      console.log(`[4] ✓ /super-admin/tenants/new renders a form`);
    } else {
      console.error(`[4] ✗ /super-admin/tenants/new did not render a form`);
      failures += 1;
    }

    if (failures > 0) {
      console.error(`\n✗ ${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log("\n✓ Super-admin routing check passed.");
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
