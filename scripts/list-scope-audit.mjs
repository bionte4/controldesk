#!/usr/bin/env node
/**
 * List-page scope smoke test.
 *
 * Confirms that after the "sweep" fix in commit adjacent to this
 * file, each of the following list pages restricts row visibility
 * per rules §3 (project-scope / employee-scope). We compare row
 * counts across roles and flag any page where a plain EMPLOYEE or
 * SUPERVISOR sees the same number of rows as TENANT_ADMIN.
 *
 * Pages surveyed (order matches the todo list):
 *   • /finance/cash-advances
 *   • /finance/expenses
 *   • /hr/requests
 *   • /hr/roster
 *   • /hr/timesheets
 *   • /hr/timesheets/weekly
 *   • /approvals
 *   • /handovers
 *
 * Assumptions:
 *   • dev/prod container running at http://demo.localhost:3001
 *     (override via LIST_AUDIT_BASE_URL)
 *   • Standard demo seed applied.
 *
 * Usage:
 *   LIST_AUDIT_BASE_URL=http://demo.localhost:3001 \
 *     node scripts/list-scope-audit.mjs
 */
import { chromium } from "@playwright/test";

const BASE =
  process.env.LIST_AUDIT_BASE_URL ?? "http://demo.localhost:3001";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 30_000;

// Petty-Cash Custodian (`bendahara@demo`) is the load-bearing control
// role in this audit. In the current seed, ALL expense/CA/HR-request/
// timesheet rows are owned by `employee@demo`, so an admin_count ==
// employee_count comparison is a false positive (self-filter matches
// every row). PCC has zero project assignments and zero submissions
// in seed, so if the filter is correctly applied PCC MUST see 0 rows
// on those lists. That's the true leak canary.
const USERS = [
  { email: "admin@demo.controldesk.app", role: "TENANT_ADMIN" },
  { email: "om@demo.controldesk.app", role: "OPERATIONS_MANAGER" },
  { email: "pm@demo.controldesk.app", role: "PROJECT_MANAGER" },
  { email: "supervisor@demo.controldesk.app", role: "SUPERVISOR" },
  { email: "employee@demo.controldesk.app", role: "EMPLOYEE" },
  { email: "pettycash@demo.controldesk.app", role: "PETTY_CASH_CUSTODIAN" },
];

// The `expect` map is keyed on role → assertion kind:
//   • `zero`               — MUST see 0 rows (PCC canary: no
//     assignments + no submissions in seed).
//   • `strictlyLessThanAdmin` — MUST see fewer rows than admin
//     (used for `/hr/roster`, `/hr/timesheets` where the seed
//     has multi-employee rows so scope filter narrows visibly).
//   • `atMostAdmin`        — MAY equal admin count (e.g. all rows
//     happen to be on their project OR filed by them). Not a
//     strong signal on its own — pair with a `zero` canary.
//   • `handoversForbidden` — page-level guard redirects the role.
const PAGES = [
  {
    path: "/finance/cash-advances",
    rowSelector: "tbody tr",
    expect: {
      EMPLOYEE: "atMostAdmin",
      SUPERVISOR: "atMostAdmin",
      PROJECT_MANAGER: "atMostAdmin",
      PETTY_CASH_CUSTODIAN: "zero",
    },
  },
  {
    path: "/finance/expenses",
    rowSelector: "tbody tr",
    expect: {
      EMPLOYEE: "atMostAdmin",
      SUPERVISOR: "atMostAdmin",
      PROJECT_MANAGER: "atMostAdmin",
      PETTY_CASH_CUSTODIAN: "zero",
    },
  },
  {
    path: "/hr/requests",
    rowSelector: "tbody tr",
    expect: {
      EMPLOYEE: "atMostAdmin",
      SUPERVISOR: "atMostAdmin",
      PROJECT_MANAGER: "atMostAdmin",
      PETTY_CASH_CUSTODIAN: "zero",
    },
  },
  {
    path: "/hr/roster",
    rowSelector: "tbody tr",
    expect: {
      EMPLOYEE: "strictlyLessThanAdmin",
      SUPERVISOR: "atMostAdmin",
      PROJECT_MANAGER: "atMostAdmin",
      PETTY_CASH_CUSTODIAN: "zero",
    },
  },
  {
    path: "/hr/timesheets",
    rowSelector: "tbody tr",
    expect: {
      EMPLOYEE: "strictlyLessThanAdmin",
      SUPERVISOR: "atMostAdmin",
      PROJECT_MANAGER: "atMostAdmin",
      PETTY_CASH_CUSTODIAN: "zero",
    },
  },
  {
    path: "/hr/timesheets/weekly",
    rowSelector: "tbody tr",
    expect: {
      EMPLOYEE: "atMostAdmin",
      SUPERVISOR: "atMostAdmin",
      PROJECT_MANAGER: "atMostAdmin",
      PETTY_CASH_CUSTODIAN: "zero",
    },
  },
  {
    path: "/approvals",
    // Approvals cards are rendered as `<Link>` anchors carrying the
    // shared `glass rounded-2xl border-white/10 p-4` combination
    // inside <section> blocks. Restricting to `a.glass.rounded-2xl`
    // filters out (a) sidebar links (which don't have `.glass`)
    // AND (b) the `EmptyState` card (which is a `<div>`, not an
    // `<a>` — the empty state doesn't link anywhere).
    rowSelector: 'main a.glass.rounded-2xl',
    expect: {
      EMPLOYEE: "atMostAdmin",
      SUPERVISOR: "atMostAdmin",
      PROJECT_MANAGER: "atMostAdmin",
      // PCC isn't gated at page-level but has no approver seat, so
      // every status bucket is empty for them.
      PETTY_CASH_CUSTODIAN: "zero",
    },
  },
  {
    path: "/handovers",
    rowSelector: "tbody tr",
    expect: {
      EMPLOYEE: "handoversForbidden",
      SUPERVISOR: "handoversForbidden",
      PROJECT_MANAGER: "atMostAdmin",
      PETTY_CASH_CUSTODIAN: "handoversForbidden",
    },
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

async function visitAndCount(page, path, selector) {
  const resp = await page.goto(`${BASE}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT,
  });
  // Some pages redirect denied roles to /dashboard?error=forbidden
  const url = page.url();
  if (url.includes("/dashboard") && path !== "/dashboard") {
    return { rows: -1, redirected: true, finalUrl: url };
  }
  await page.waitForTimeout(1200);
  const rows = await page.locator(selector).count();
  return { rows, redirected: false, finalUrl: url, status: resp?.status() };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  /** @type {Map<string, Map<string, {rows:number,redirected:boolean}>>} */
  const table = new Map();
  let failures = 0;

  for (const user of USERS) {
    log(`\n─── ${user.email} (${user.role}) ───`);
    // Backoff for GoTrue rate-limiter between roles.
    await new Promise((r) => setTimeout(r, 4000));
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const rolePages = new Map();
    try {
      await loginAs(page, user.email);
      for (const p of PAGES) {
        const result = await visitAndCount(page, p.path, p.rowSelector);
        rolePages.set(p.path, result);
        log(
          `  ${p.path.padEnd(28)} rows=${String(result.rows).padStart(3)} ${result.redirected ? "(redirected → " + result.finalUrl.replace(BASE, "") + ")" : ""}`,
        );
      }
    } catch (err) {
      console.error(
        `  ✗ ${user.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failures += 1;
    } finally {
      table.set(user.role, rolePages);
      await context.close();
    }
  }
  await browser.close();

  // ------------------------------------------------------------------
  // Leak checks — cross-reference each role's row count vs admin's.
  // ------------------------------------------------------------------
  console.log("\n=== Row count table (role × page) ===");
  const roles = USERS.map((u) => u.role);
  const paths = PAGES.map((p) => p.path);
  const header = ["page".padEnd(28), ...roles.map((r) => r.padStart(14))].join(
    "",
  );
  console.log(header);
  console.log("-".repeat(header.length));
  for (const p of paths) {
    const row = [p.padEnd(28)];
    for (const r of roles) {
      const cell = table.get(r)?.get(p);
      const label = !cell
        ? "?"
        : cell.redirected
          ? "→dashboard"
          : String(cell.rows);
      row.push(label.padStart(14));
    }
    console.log(row.join(""));
  }
  console.log();

  const admin = table.get("TENANT_ADMIN");
  for (const p of PAGES) {
    const adminCell = admin?.get(p.path);
    if (!adminCell || adminCell.rows < 0) continue;
    for (const [role, kind] of Object.entries(p.expect)) {
      const cell = table.get(role)?.get(p.path);
      if (!cell) continue;

      if (kind === "handoversForbidden") {
        if (!cell.redirected) {
          console.error(
            `✗ ${p.path} — ${role} should be redirected but saw rows=${cell.rows}`,
          );
          failures += 1;
        } else {
          console.log(`✓ ${p.path} — ${role} correctly redirected`);
        }
        continue;
      }

      if (cell.redirected) {
        console.log(
          `  ${p.path} — ${role} redirected (page-level guard OK, not a leak)`,
        );
        continue;
      }

      if (kind === "zero") {
        if (cell.rows === 0) {
          console.log(`✓ ${p.path} — ${role} sees 0 rows (canary)`);
        } else {
          console.error(
            `✗ ${p.path} — ${role} sees ${cell.rows} rows, expected 0 (leak canary tripped)`,
          );
          failures += 1;
        }
      } else if (kind === "strictlyLessThanAdmin") {
        if (cell.rows >= adminCell.rows && adminCell.rows > 0) {
          console.error(
            `✗ ${p.path} — ${role} sees ${cell.rows} rows, admin sees ${adminCell.rows} (expected fewer)`,
          );
          failures += 1;
        } else {
          console.log(
            `✓ ${p.path} — ${role} sees ${cell.rows} rows < admin's ${adminCell.rows}`,
          );
        }
      } else if (kind === "atMostAdmin") {
        if (cell.rows > adminCell.rows) {
          console.error(
            `✗ ${p.path} — ${role} sees ${cell.rows} rows > admin ${adminCell.rows}`,
          );
          failures += 1;
        } else {
          console.log(
            `  ${p.path} — ${role} sees ${cell.rows} rows ≤ admin ${adminCell.rows}`,
          );
        }
      }
    }
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ List-page scope audit passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
