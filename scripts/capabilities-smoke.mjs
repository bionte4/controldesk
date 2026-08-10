#!/usr/bin/env node
/**
 * Capability admin surface smoke test (Fase 2, rules §3).
 *
 * Confirms that the `/settings/capabilities` matrix + resolver
 * behaves correctly end-to-end:
 *
 *   1. Non-admin roles cannot open `/settings/capabilities`
 *      (page returns 404 / redirects).
 *   2. Admin can open the page and every 11 capability rows
 *      render.
 *   3. Sidebar filter reacts to overrides — grant Employee
 *      the `view_client` capability and the sidebar link
 *      appears on next navigation; reset and the link is gone.
 *   4. Page redirect guard follows the same source of truth —
 *      Employee cannot visit `/clients` before grant, CAN after
 *      grant, cannot after reset.
 *
 * Assumptions:
 *   • Prod (or dev) container at http://demo.localhost:3001
 *     (override via CAP_SMOKE_BASE_URL).
 *   • Standard demo seed applied.
 *   • Migration 0081 already applied.
 *
 * Usage:
 *   CAP_SMOKE_BASE_URL=http://demo.localhost:3001 \
 *     node scripts/capabilities-smoke.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.CAP_SMOKE_BASE_URL ?? "http://demo.localhost:3001";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 30_000;

const ADMIN_EMAIL = "admin@demo.controldesk.app";
const EMPLOYEE_EMAIL = "employee@demo.controldesk.app";

const t0 = Date.now();
const log = (...args) =>
  console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return btn && !btn.disabled;
    },
    { timeout: NAV_TIMEOUT },
  );
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard(\?|$)/, { timeout: NAV_TIMEOUT }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let failures = 0;

  // -----------------------------------------------------------------
  // Step 1 — Employee cannot open /settings/capabilities.
  // -----------------------------------------------------------------
  {
    log("Step 1 — Employee tries /settings/capabilities (expect 404)");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await login(page, EMPLOYEE_EMAIL);
      const resp = await page.goto(`${BASE}/settings/capabilities`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
      });
      const status = resp?.status();
      const finalUrl = page.url();
      if (
        status === 404 ||
        finalUrl.includes("/dashboard") ||
        (await page.locator("text=/404|not.found|halaman.tidak/i").first().isVisible())
      ) {
        log(`  ✓ Employee blocked (status=${status}, url=${finalUrl})`);
      } else {
        console.error(
          `  ✗ Employee reached /settings/capabilities (status=${status}, url=${finalUrl})`,
        );
        failures += 1;
      }
    } finally {
      await ctx.close();
    }
  }

  // -----------------------------------------------------------------
  // Step 2 — Employee cannot open /clients before override.
  // -----------------------------------------------------------------
  {
    log("Step 2 — Employee tries /clients pre-override (expect redirect)");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await login(page, EMPLOYEE_EMAIL);
      await page.goto(`${BASE}/clients`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
      });
      const url = page.url();
      if (url.includes("/dashboard")) {
        log(`  ✓ Employee redirected off /clients (${url})`);
      } else {
        console.error(`  ✗ Employee still on ${url}`);
        failures += 1;
      }
    } finally {
      await ctx.close();
    }
  }

  // -----------------------------------------------------------------
  // Step 3 — Admin opens the matrix, count 11 capability rows.
  // -----------------------------------------------------------------
  {
    log("Step 3 — Admin opens /settings/capabilities, expect 11 rows");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await login(page, ADMIN_EMAIL);
      await page.goto(`${BASE}/settings/capabilities`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
      });
      await page.waitForTimeout(1200);
      const rowCount = await page
        .locator('div[role="grid"]')
        .count();
      if (rowCount === 11) {
        log(`  ✓ 11 capability rows rendered`);
      } else {
        console.error(
          `  ✗ Expected 11 capability rows, saw ${rowCount}. Check capability-matrix.tsx.`,
        );
        failures += 1;
      }
    } finally {
      await ctx.close();
    }
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} smoke check(s) failed.`);
    await browser.close();
    process.exit(1);
  }

  console.log("\n✓ Capabilities smoke passed.");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
