#!/usr/bin/env node
/**
 * Dashboard scope smoke test — confirms that KPI values on
 * `/dashboard` differ per role after the ABAC scoping fix.
 *
 * Assumptions:
 *   - dev server running at http://demo.localhost:3000
 *     (override via DASHBOARD_AUDIT_BASE_URL)
 *   - demo seed already applied (`supabase/seed.sql`)
 *
 * Usage:
 *   DASHBOARD_AUDIT_BASE_URL=http://demo.localhost:3000 \
 *     node scripts/dashboard-scope-audit.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.DASHBOARD_AUDIT_BASE_URL ?? "http://demo.localhost:3000";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 30_000;

const USERS = [
  { email: "admin@demo.controldesk.app", role: "TENANT_ADMIN", expectScope: "org" },
  { email: "om@demo.controldesk.app", role: "OPERATIONS_MANAGER", expectScope: "portfolio" },
  { email: "pm@demo.controldesk.app", role: "PROJECT_MANAGER", expectScope: "assigned" },
  { email: "supervisor@demo.controldesk.app", role: "SUPERVISOR", expectScope: "assigned" },
  { email: "employee@demo.controldesk.app", role: "EMPLOYEE", expectScope: "assigned" },
];

const t0 = Date.now();
const log = (...args) =>
  console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);

async function loginAs(page, email) {
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

async function readKpis(page) {
  // KpiCard is defined in src/components/kpi-card.tsx. It renders
  // an accessible label + a large formatted value. We fall back to
  // scraping visible text if a data-test-id isn't present.
  const cards = await page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-slot="card"]');
    const out = [];
    for (const node of nodes) {
      const labelEl = node.querySelector('[class*="label-meta"], p, span');
      const valueEl = node.querySelector('h2, h3, .font-display, .text-2xl, .text-3xl');
      if (labelEl && valueEl) {
        out.push({
          label: (labelEl.textContent ?? "").trim(),
          value: (valueEl.textContent ?? "").trim(),
        });
      }
      if (out.length >= 5) break;
    }
    return out;
  });
  return cards;
}

async function readScopeBadge(page) {
  const badge = await page
    .locator("header")
    .locator("text=/portfolio scope|assigned scope/i")
    .first()
    .textContent()
    .catch(() => null);
  return badge?.trim() ?? "org";
}

async function readPortfolioProjectCount(page) {
  const anchors = await page.locator('a[href*="/projects/"]').all();
  return anchors.length;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let failures = 0;

  for (const user of USERS) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    log(`Login as ${user.email} (expect scope=${user.expectScope})`);
    // Backoff between accounts — the local GoTrue rate-limiter
    // starts dropping requests when we hammer /token in rapid
    // succession, which surfaces as a `waitForURL` timeout.
    await new Promise((r) => setTimeout(r, 4000));
    try {
      await loginAs(page, user.email);
      // Give dashboard a moment to hydrate KPI cards
      await page.waitForTimeout(1500);
      const kpis = await readKpis(page);
      const scope = await readScopeBadge(page);
      const portfolioProjects = await readPortfolioProjectCount(page);
      results.push({ user, kpis, scope, portfolioProjects });
      log(
        `  scope badge = ${scope}, kpis = ${kpis.length}, portfolio-links = ${portfolioProjects}`,
      );
      const scopeOk =
        user.expectScope === "org"
          ? scope === "org"
          : scope.toLowerCase().includes(user.expectScope);
      if (!scopeOk) {
        failures += 1;
        console.error(
          `  ✗ scope mismatch: expected ${user.expectScope}, got "${scope}"`,
        );
      } else {
        console.log(`  ✓ scope OK`);
      }
    } catch (err) {
      failures += 1;
      console.error(
        `  ✗ ${user.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
      results.push({ user, error: String(err) });
    } finally {
      await context.close();
    }
  }
  await browser.close();

  console.log("\n=== KPI table (role × KPI value) ===");
  const kpiIds = ["active_projects", "approved_budget", "milestone_done_pct", "pending_approvals", "issues_at_risk"];
  const header = ["role".padEnd(20), ...kpiIds.map((k) => k.padEnd(18))].join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    const kpiValues = r.kpis?.slice(0, 5).map((c) => c.value.padEnd(18)) ?? [];
    console.log([r.user.role.padEnd(20), ...kpiValues].join(""));
  }
  console.log();

  // Basic leak check — a plain EMPLOYEE should not see more active
  // projects than an assigned technician normally has (usually ≤3 in
  // the demo seed). If the value equals the admin's, that's a leak.
  const admin = results.find((r) => r.user.role === "TENANT_ADMIN");
  const employee = results.find((r) => r.user.role === "EMPLOYEE");
  if (admin?.kpis?.[0] && employee?.kpis?.[0]) {
    const adminActive = admin.kpis[0].value;
    const empActive = employee.kpis[0].value;
    if (adminActive === empActive) {
      failures += 1;
      console.error(
        `✗ LEAK: EMPLOYEE sees the same active_projects (${empActive}) as TENANT_ADMIN — scope not applied.`,
      );
    } else {
      console.log(
        `✓ EMPLOYEE active_projects (${empActive}) ≠ TENANT_ADMIN (${adminActive}) — scope applied.`,
      );
    }
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Dashboard scope audit passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
