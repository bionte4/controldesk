#!/usr/bin/env node
/**
 * Fresh-tenant smoke test — validates the migration 0082 fix end-to-end.
 *
 * Login as the freshly-provisioned TENANT_ADMIN of test-acme and confirm:
 *
 *   1. Login → /dashboard (host preserved, no marketing leak).
 *   2. Sidebar shows all TENANT_ADMIN sections.
 *   3. /settings/lookups renders with 3 seeded domains
 *      (department, position, budget_category) — the exact fix from
 *      migration 0082 that plugged the seed_default_master_data gap.
 *   4. /settings/capabilities loads the admin matrix (Fase 2 admin UI
 *      reachable for a brand-new tenant, no seed data required).
 *   5. /finance/budgets is reachable (CoA seed produced by
 *      seed_default_coa keeps budget-line-item form functional).
 *
 * Usage:
 *   node scripts/test-acme-smoke.mjs [password]
 *
 * If [password] is omitted, defaults to the one that was printed by
 * `pnpm tenant:create` during the current session — pass it explicitly
 * if you re-provisioned since then.
 */
import { chromium } from "@playwright/test";

const BASE = "http://test-acme.localhost:3001";
const EMAIL = "admin@test-acme.controldesk.app";
const PASSWORD = process.argv[2] ?? "fzMd0SsIacyuqI-5XwRPbQxeBmMqfvIr";
const NAV_TIMEOUT = 20_000;

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

async function login() {
  log("Navigating to /login…");
  const resp = await page.goto("/login", { waitUntil: "domcontentloaded" });
  if (!resp || resp.status() !== 200) {
    throw new Error(`GET /login expected 200, got ${resp?.status()}`);
  }

  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return btn && !btn.disabled;
    },
    { timeout: NAV_TIMEOUT },
  );

  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);

  await Promise.all([
    page.waitForURL(/\/dashboard(\?|$)/, { timeout: NAV_TIMEOUT }),
    submit.click(),
  ]);
  pass(`Login OK → ${page.url()}`);
}

try {
  await login();

  const url = new URL(page.url());
  if (url.host !== "test-acme.localhost:3001") {
    fail(`Wrong host after login: ${url.host}`);
  } else {
    pass(`Host preserved: ${url.host}`);
  }

  const sidebar = page.locator('[data-slot="sidebar"], aside').first();
  await sidebar
    .waitFor({ state: "visible", timeout: NAV_TIMEOUT })
    .catch(() => {});
  const sidebarVisible = await sidebar.isVisible().catch(() => false);
  if (!sidebarVisible) fail("Sidebar not visible on /dashboard");
  else pass("Sidebar visible");

  // Sidebar should include the admin group for TENANT_ADMIN.
  const bodyText = (await page.textContent("body")) ?? "";
  const expectSidebar = ["Dashboard", "Projects", "Finance", "HR", "Settings"];
  for (const label of expectSidebar) {
    if (bodyText.includes(label)) pass(`Sidebar has "${label}"`);
    else fail(`Sidebar missing "${label}"`);
  }

  // ---------------------------------------------------------------------
  // Check /settings/lookups (proves 0082 fix landed).
  // ---------------------------------------------------------------------
  log("Navigating to /settings/lookups…");
  const lookupsResp = await page.goto("/settings/lookups", {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT,
  });
  if (!lookupsResp || lookupsResp.status() !== 200) {
    fail(`/settings/lookups status ${lookupsResp?.status()}`);
  } else {
    pass("/settings/lookups reachable (200)");
  }

  // Wait a tick for the page to hydrate before scraping text.
  await page
    .waitForLoadState("networkidle", { timeout: NAV_TIMEOUT })
    .catch(() => {});
  const lookupsText = (await page.textContent("body")) ?? "";
  const expectedDomains = [
    ["Department", "department"],
    ["Position", "position"],
    ["Budget", "budget_category"],
  ];
  for (const [label] of expectedDomains) {
    if (new RegExp(label, "i").test(lookupsText)) {
      pass(`/settings/lookups mentions "${label}"`);
    } else {
      fail(`/settings/lookups missing label "${label}"`);
    }
  }

  // ---------------------------------------------------------------------
  // Check /settings/capabilities loads.
  // ---------------------------------------------------------------------
  log("Navigating to /settings/capabilities…");
  const capsResp = await page.goto("/settings/capabilities", {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT,
  });
  if (!capsResp || capsResp.status() !== 200) {
    fail(`/settings/capabilities status ${capsResp?.status()}`);
  } else {
    pass("/settings/capabilities reachable (200)");
  }
  await page
    .waitForLoadState("networkidle", { timeout: NAV_TIMEOUT })
    .catch(() => {});
  const capsText = (await page.textContent("body")) ?? "";
  const capsSignals = ["view_budget", "view_petty_cash", "view_payroll"];
  for (const cap of capsSignals) {
    if (capsText.includes(cap)) pass(`Capability catalog shows "${cap}"`);
    else fail(`Capability catalog missing "${cap}"`);
  }

  // ---------------------------------------------------------------------
  // Check /finance/budgets is reachable (uses CoA + budget_category
  // lookup indirectly for line items).
  // ---------------------------------------------------------------------
  log("Navigating to /finance/budgets…");
  const budgetsResp = await page.goto("/finance/budgets", {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT,
  });
  if (!budgetsResp || budgetsResp.status() !== 200) {
    fail(`/finance/budgets status ${budgetsResp?.status()}`);
  } else {
    pass("/finance/budgets reachable (200)");
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
console.log(`\n✓ Fresh-tenant smoke test passed against ${BASE}/login`);
