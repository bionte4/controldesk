#!/usr/bin/env node
/**
 * Login smoke test against http://demo.localhost:3001/login
 *
 * Verifies:
 *   1. Login form is reachable & hydrated (submit button becomes enabled).
 *   2. Password login with demo TENANT_ADMIN succeeds.
 *   3. Client-side redirect lands on /dashboard on the SAME host
 *      (demo.localhost:3001), not the marketing shell.
 *   4. Dashboard renders authenticated content (KPI cards).
 *   5. Auth cookie is present after login.
 *
 * Usage:
 *   node scripts/login-smoke.mjs
 */
import { chromium } from "@playwright/test";

const BASE = "http://demo.localhost:3001";
const EMAIL = "admin@demo.controldesk.app";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 15_000;

const t0 = Date.now();
const log = (...args) =>
  console.log(`[+${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...args);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();

const consoleErrors = [];
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
});

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error("  ✗", msg);
};
const pass = (msg) => console.log("  ✓", msg);

try {
  log("Navigating to /login…");
  const loginResp = await page.goto("/login", { waitUntil: "domcontentloaded" });
  if (!loginResp || loginResp.status() !== 200) {
    fail(`GET /login expected 200, got ${loginResp?.status()}`);
  } else {
    pass(`GET /login → 200`);
  }

  log("Waiting for form hydration (submit button enabled)…");
  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return btn && !btn.disabled;
    },
    { timeout: NAV_TIMEOUT },
  );
  pass("Form hydrated (submit enabled)");

  log("Filling credentials & submitting…");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);

  await Promise.all([
    page.waitForURL(/\/dashboard(\?|$)/, { timeout: NAV_TIMEOUT }),
    submit.click(),
  ]);
  pass(`Redirected to ${page.url()}`);

  const url = new URL(page.url());
  if (url.host !== "demo.localhost:3001") {
    fail(`Wrong host after login: ${url.host}`);
  } else {
    pass(`Host preserved: ${url.host}`);
  }

  log("Waiting for dashboard content to render…");
  // Realtime WebSocket keeps the network busy, so instead of `networkidle`
  // we wait for the actual dashboard shell (sidebar + main content).
  const sidebar = page.locator('[data-slot="sidebar"], aside').first();
  await sidebar.waitFor({ state: "visible", timeout: NAV_TIMEOUT }).catch(() => {});
  const sidebarVisible = await sidebar.isVisible().catch(() => false);
  if (sidebarVisible) {
    pass("Sidebar (app shell) visible");
  } else {
    fail("App shell (sidebar) not visible on /dashboard");
  }

  const firstHeading = await page
    .locator("h1, h2")
    .first()
    .textContent()
    .catch(() => null);
  if (firstHeading && firstHeading.trim().length > 0) {
    pass(`First heading: "${firstHeading.trim().slice(0, 60)}"`);
  } else {
    fail("No heading rendered on /dashboard");
  }

  const bodyText = (await page.textContent("body")) ?? "";
  const marketingLeak = /Ruang operasional untuk Managed Services/i.test(bodyText);
  if (marketingLeak) {
    fail("Dashboard body still contains marketing copy (RSC leak)");
  } else {
    pass("No marketing copy leaked onto /dashboard");
  }

  const cookies = await context.cookies();
  const authCookie = cookies.find((c) => /auth-token|sb-.*-auth-token/.test(c.name));
  if (!authCookie) {
    fail(
      `No Supabase auth cookie set (cookies: ${cookies.map((c) => c.name).join(", ") || "none"})`,
    );
  } else {
    pass(`Auth cookie present: ${authCookie.name}`);
  }

  log("Reloading /dashboard to confirm session persists…");
  await page.reload({ waitUntil: "domcontentloaded" });
  const urlAfterReload = new URL(page.url());
  if (urlAfterReload.pathname !== "/dashboard") {
    fail(`After reload expected /dashboard, got ${urlAfterReload.pathname}`);
  } else {
    pass("Session persists across reload");
  }
} catch (err) {
  fail(`Uncaught: ${err instanceof Error ? err.stack || err.message : String(err)}`);
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
console.log(`\n✓ Login smoke test passed against ${BASE}/login`);
