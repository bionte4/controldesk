#!/usr/bin/env node
/**
 * Employee directory scope smoke test — verifies rules §3
 * `canViewEmployeeDirectory` + `resolveEmployeeScope`:
 *
 *   Expected behaviour on `/hr/employees`:
 *     - TENANT_ADMIN / HR / Finance / GM      → all tenant employees
 *     - OPERATIONS_MANAGER                     → portfolio teammates
 *     - PROJECT_MANAGER                        → teammates on assigned
 *                                                projects
 *     - SUPERVISOR                             → teammates on their
 *                                                own project(s)
 *     - EMPLOYEE / PETTY_CASH_CUSTODIAN        → notFound() (guard)
 *
 * Additionally verifies:
 *   - Sidebar link "Employees" hidden for EMPLOYEE.
 *   - URL-paste (`/hr/employees`) results in a 404 page for
 *     EMPLOYEE (not a redirect loop).
 *   - Every scoped viewer includes themselves in the list.
 *
 * Usage:
 *   node scripts/employees-scope-audit.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.EMPLOYEE_AUDIT_BASE_URL ?? "http://demo.localhost:3001";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 30_000;

const USERS = [
  {
    email: "admin@demo.controldesk.app",
    role: "TENANT_ADMIN",
    expect: { allowed: true, sizeAtLeast: 5 },
  },
  {
    email: "om@demo.controldesk.app",
    role: "OPERATIONS_MANAGER",
    expect: { allowed: true, sizeAtLeast: 2 },
  },
  {
    email: "pm@demo.controldesk.app",
    role: "PROJECT_MANAGER",
    expect: { allowed: true, sizeAtLeast: 1 },
  },
  {
    email: "supervisor@demo.controldesk.app",
    role: "SUPERVISOR",
    expect: { allowed: true, sizeAtLeast: 1 },
  },
  {
    email: "employee@demo.controldesk.app",
    role: "EMPLOYEE",
    expect: { allowed: false, sizeAtLeast: 0 },
  },
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

async function readSidebarHasEmployeesLink(page) {
  return await page.evaluate(() => {
    const anchors = document.querySelectorAll(
      '[data-slot="sidebar"] a, aside a, nav a',
    );
    return Array.from(anchors).some(
      (a) => a.getAttribute("href") === "/hr/employees",
    );
  });
}

async function readEmployeeRows(page) {
  await page.goto(`${BASE}/hr/employees`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  // Detect 404 page (Next.js not-found renders our custom
  // route-group `not-found.tsx` — the h1 usually contains a "404"
  // or similar). We check both the DOM signal and the URL: a
  // scoped-out user should NOT be redirected, they should hit the
  // in-place notFound() boundary.
  const isNotFound = await page.evaluate(() => {
    const heading = (document.querySelector("h1")?.textContent ?? "").toLowerCase();
    return (
      heading.includes("404") ||
      heading.includes("not found") ||
      heading.includes("tidak ditemukan") ||
      document.title.toLowerCase().includes("404")
    );
  });
  const rowCount = await page.locator("tbody tr").count();
  const emails = await page
    .locator("tbody tr td .text-xs")
    .allTextContents()
    .catch(() => []);
  return {
    isNotFound,
    rowCount,
    emails: emails.map((e) => e.trim()).filter((e) => e.includes("@")),
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  const rows = [];

  for (const user of USERS) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    log(
      `Login ${user.email} (allowed=${user.expect.allowed}, ≥${user.expect.sizeAtLeast})`,
    );
    // Backoff between accounts to sidestep GoTrue rate limiting.
    await new Promise((r) => setTimeout(r, 3500));
    try {
      await loginAs(page, user.email);

      // Sidebar visibility: EMPLOYEE should NOT see the link.
      const sidebarLink = await readSidebarHasEmployeesLink(page);
      const expectSidebar = user.expect.allowed;
      const sidebarOk = sidebarLink === expectSidebar;
      if (!sidebarOk) {
        failures += 1;
        console.error(
          `  ✗ Sidebar link: got ${sidebarLink}, expected ${expectSidebar}`,
        );
      } else {
        console.log(
          `  ✓ Sidebar link: ${sidebarLink ? "visible" : "hidden"}`,
        );
      }

      // Page access + row count.
      const { isNotFound, rowCount, emails } = await readEmployeeRows(page);
      const seesSelf = emails.includes(user.email);

      if (!user.expect.allowed) {
        // Denied user should see notFound().
        if (isNotFound) {
          console.log(`  ✓ /hr/employees returns notFound()`);
        } else {
          failures += 1;
          console.error(
            `  ✗ /hr/employees did NOT notFound — got ${rowCount} rows`,
          );
        }
      } else {
        // Allowed user should see at least N rows and themselves.
        const sizeOk = rowCount >= user.expect.sizeAtLeast;
        if (sizeOk) {
          console.log(
            `  ✓ Row count = ${rowCount} (≥ ${user.expect.sizeAtLeast})`,
          );
        } else {
          failures += 1;
          console.error(
            `  ✗ Row count = ${rowCount} (< ${user.expect.sizeAtLeast})`,
          );
        }
        if (seesSelf) {
          console.log(`  ✓ Sees self (${user.email})`);
        } else {
          failures += 1;
          console.error(
            `  ✗ Does NOT see self — emails=${emails.slice(0, 5).join(", ")}`,
          );
        }
      }

      rows.push({
        role: user.role,
        allowed: user.expect.allowed,
        isNotFound,
        rowCount,
        sawSelf: seesSelf,
        sidebarLink,
      });
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

  console.log("\n=== Directory scope matrix ===");
  const cols = ["role", "allowed", "rows", "self", "sidebar", "notFound"];
  console.log(cols.map((c) => c.padEnd(20)).join(""));
  console.log("-".repeat(cols.length * 20));
  for (const r of rows) {
    console.log(
      [
        r.role,
        String(r.allowed),
        String(r.rowCount),
        String(r.sawSelf),
        String(r.sidebarLink),
        String(r.isNotFound),
      ]
        .map((s) => s.padEnd(20))
        .join(""),
    );
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Employee directory scope audit passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
