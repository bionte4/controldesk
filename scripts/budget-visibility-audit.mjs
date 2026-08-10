#!/usr/bin/env node
/**
 * Budget visibility smoke test.
 *
 * Verifies rules §3 / capability gate `canViewBudget()`:
 *   - EMPLOYEE / SUPERVISOR see NO budget UI anywhere
 *     (no "Approved Budget" KPI, no "Anggaran" column on
 *     /projects, no Budget / Direct Labor / Expenses card on
 *     /projects/[id]).
 *   - PROJECT_MANAGER / OPERATIONS_MANAGER / TENANT_ADMIN
 *     continue to see the full budget UI (regression check).
 *
 * Assumptions:
 *   - Prod container running at http://demo.localhost:3001
 *     (override via BUDGET_AUDIT_BASE_URL)
 *   - demo seed already applied
 *
 * Usage:
 *   node scripts/budget-visibility-audit.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BUDGET_AUDIT_BASE_URL ?? "http://demo.localhost:3001";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 30_000;

const USERS = [
  { email: "admin@demo.controldesk.app", role: "TENANT_ADMIN", expectBudget: true },
  { email: "om@demo.controldesk.app", role: "OPERATIONS_MANAGER", expectBudget: true },
  { email: "pm@demo.controldesk.app", role: "PROJECT_MANAGER", expectBudget: true },
  { email: "supervisor@demo.controldesk.app", role: "SUPERVISOR", expectBudget: false },
  { email: "employee@demo.controldesk.app", role: "EMPLOYEE", expectBudget: false },
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

async function readDashboardKpiLabels(page) {
  await page.waitForTimeout(1000);
  // Read text of the first up-to-6 KPI cards (before the portfolio
  // snapshot). The KpiCard renders a plain <p> with the translated
  // label — no data-test-id yet, so we walk cards and grab text.
  return await page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-slot="card"]');
    return Array.from(nodes)
      .slice(0, 6)
      .map((c) => (c.textContent ?? "").trim().slice(0, 80));
  });
}

async function readProjectsListHeader(page) {
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const headers = await page.locator("thead th").allTextContents();
  const firstHref = await page
    .locator('tbody a[href^="/projects/"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  return { headers: headers.map((h) => h.trim()), firstHref };
}

async function readProjectDetailCardTitles(page, href) {
  if (!href) return null;
  await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const titles = await page
    .locator('[data-slot="card-title"]')
    .allTextContents();
  return titles.map((t) => t.trim());
}

// Case-insensitive match on Indonesian OR English budget terminology.
const RE_BUDGET_KPI = /anggaran disetujui|approved budget/i;
const RE_BUDGET_COL = /^(anggaran|budget)$/i;
const RE_BUDGET_CARD = /^(anggaran|budget)$/i;
const RE_EXPENSES_CARD = /biaya terbaru|recent expenses/i;
const RE_DLC_CARD = /tenaga kerja langsung|direct labor/i;

async function main() {
  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  const rows = [];

  for (const user of USERS) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    log(`Login ${user.email} (expectBudget=${user.expectBudget})`);
    await new Promise((r) => setTimeout(r, 3500));
    try {
      await loginAs(page, user.email);
      const kpiTexts = await readDashboardKpiLabels(page);
      const hasBudgetKpi = kpiTexts.some((t) => RE_BUDGET_KPI.test(t));

      const { headers, firstHref } = await readProjectsListHeader(page);
      const hasBudgetCol = headers.some((h) => RE_BUDGET_COL.test(h));

      const detailTitles = await readProjectDetailCardTitles(page, firstHref);
      const hasBudgetCard = detailTitles?.some((t) => RE_BUDGET_CARD.test(t)) ?? null;
      const hasExpensesCard =
        detailTitles?.some((t) => RE_EXPENSES_CARD.test(t)) ?? null;
      const hasDlcCard = detailTitles?.some((t) => RE_DLC_CARD.test(t)) ?? null;

      rows.push({
        role: user.role,
        expect: user.expectBudget,
        hasBudgetKpi,
        hasBudgetCol,
        hasBudgetCard,
        hasExpensesCard,
        hasDlcCard,
      });

      const surfaces = [
        ["Dashboard KPI", hasBudgetKpi],
        ["Projects col", hasBudgetCol],
        ["Detail Budget card", hasBudgetCard],
        ["Detail Expenses card", hasExpensesCard],
        ["Detail DLC card", hasDlcCard],
      ];
      for (const [name, visible] of surfaces) {
        if (visible === null) continue;
        const ok = visible === user.expectBudget;
        if (!ok) {
          failures += 1;
          console.error(
            `  ✗ ${name}: visible=${visible} but expectBudget=${user.expectBudget}`,
          );
        } else {
          console.log(`  ✓ ${name}: ${visible ? "visible" : "hidden"}`);
        }
      }
    } catch (err) {
      failures += 1;
      console.error(
        `  ✗ ${user.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await context.close();
    }
  }
  await browser.close();

  console.log("\n=== Budget visibility matrix ===");
  const cols = ["role", "expect", "dashKPI", "listCol", "budget", "expenses", "dlc"];
  console.log(cols.map((c) => c.padEnd(16)).join(""));
  console.log("-".repeat(cols.length * 16));
  for (const r of rows) {
    console.log(
      [
        r.role,
        String(r.expect),
        String(r.hasBudgetKpi),
        String(r.hasBudgetCol),
        String(r.hasBudgetCard),
        String(r.hasExpensesCard),
        String(r.hasDlcCard),
      ]
        .map((s) => s.padEnd(16))
        .join(""),
    );
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Budget visibility audit passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
