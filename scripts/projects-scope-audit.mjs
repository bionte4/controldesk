#!/usr/bin/env node
/**
 * `/projects` list + detail scope smoke test.
 *
 * Verifies that the projects list page and project detail page
 * enforce the same three-tier scope as `/dashboard`:
 *
 *   - EMPLOYEE (assigned): only the 2 projects `Eko` is on.
 *   - SUPERVISOR (assigned): only the 2 projects `Sinta` supervises.
 *   - PROJECT_MANAGER (assigned): only projects `Putri` runs.
 *   - OPERATIONS_MANAGER (portfolio): projects handled by any PM
 *     reporting (transitively) to Omar.
 *   - TENANT_ADMIN (org): tenant-wide.
 *
 * Also probes `notFound()` guard on the detail page: EMPLOYEE
 * URL-pasting a project ID they are NOT assigned to must get 404.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.PROJECTS_AUDIT_BASE_URL ?? "http://demo.localhost:3001";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 30_000;

const USERS = [
  { email: "admin@demo.controldesk.app", role: "TENANT_ADMIN", expectScope: "org", minRows: 5 },
  { email: "om@demo.controldesk.app", role: "OPERATIONS_MANAGER", expectScope: "portfolio", maxRows: 5 },
  { email: "pm@demo.controldesk.app", role: "PROJECT_MANAGER", expectScope: "assigned", maxRows: 5 },
  { email: "supervisor@demo.controldesk.app", role: "SUPERVISOR", expectScope: "assigned", maxRows: 3 },
  { email: "employee@demo.controldesk.app", role: "EMPLOYEE", expectScope: "assigned", maxRows: 3 },
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

async function readProjectRows(page) {
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const rows = await page
    .locator('a[href^="/projects/"]')
    .evaluateAll((links) => {
      // Table rows are anchors like /projects/<uuid>. Skip the "new
      // project" trigger and any nav link (which points to /projects
      // without an id). Deduplicate by href.
      const seen = new Set();
      const out = [];
      for (const el of links) {
        const href = el.getAttribute("href") ?? "";
        const m = href.match(/^\/projects\/([0-9a-f-]{36})/i);
        if (!m) continue;
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({
          id: m[1],
          text: (el.textContent ?? "").trim().slice(0, 60),
        });
      }
      return out;
    });
  return rows;
}

async function probeDetailAccess(page, projectId) {
  const resp = await page.goto(`${BASE}/projects/${projectId}`, {
    waitUntil: "domcontentloaded",
  });
  return resp?.status() ?? 0;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let failures = 0;

  // Step 1 — collect the full project list as TENANT_ADMIN so we
  // know a UUID we can later paste into an EMPLOYEE session.
  let allProjectIds = [];
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    log("Bootstrapping full project list via TENANT_ADMIN…");
    await new Promise((r) => setTimeout(r, 3000));
    await loginAs(page, "admin@demo.controldesk.app");
    const rows = await readProjectRows(page);
    allProjectIds = rows.map((r) => r.id);
    log(`  admin sees ${allProjectIds.length} projects`);
    await context.close();
  }

  for (const user of USERS) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    log(`Login as ${user.email} (expect scope=${user.expectScope})`);
    await new Promise((r) => setTimeout(r, 4000));
    try {
      await loginAs(page, user.email);
      const rows = await readProjectRows(page);
      log(`  /projects rows visible: ${rows.length}`);
      results.push({ user, count: rows.length, ids: rows.map((r) => r.id) });

      if (user.minRows != null && rows.length < user.minRows) {
        failures += 1;
        console.error(`  ✗ expected ≥${user.minRows} rows, got ${rows.length}`);
      } else if (user.maxRows != null && rows.length > user.maxRows) {
        failures += 1;
        console.error(`  ✗ expected ≤${user.maxRows} rows, got ${rows.length}`);
      } else {
        console.log(`  ✓ row count OK`);
      }

      // Detail-page probe: only for assigned/portfolio users, and
      // only when we have a project the caller is NOT expected to
      // reach (assumption: admin's full list ⊇ caller's list).
      if (user.expectScope !== "org" && allProjectIds.length > 0) {
        const forbiddenId = allProjectIds.find((id) => !rows.find((r) => r.id === id));
        if (forbiddenId) {
          const status = await probeDetailAccess(page, forbiddenId);
          const okId = rows[0]?.id;
          const statusAllowed = okId ? await probeDetailAccess(page, okId) : null;
          console.log(
            `  detail probe: forbidden=${forbiddenId.slice(0, 8)}→${status}, allowed=${
              okId ? `${okId.slice(0, 8)}→${statusAllowed}` : "n/a"
            }`,
          );
          if (status !== 404) {
            failures += 1;
            console.error(
              `  ✗ /projects/${forbiddenId} returned ${status} (expected 404 notFound)`,
            );
          } else {
            console.log(`  ✓ URL-paste to forbidden project 404s`);
          }
          if (okId && statusAllowed !== 200) {
            failures += 1;
            console.error(
              `  ✗ /projects/${okId} returned ${statusAllowed} (expected 200)`,
            );
          }
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

  console.log("\n=== Projects scope table ===");
  console.log("role                rows  scope");
  console.log("-".repeat(48));
  for (const r of results) {
    console.log(
      `${r.user.role.padEnd(20)}${String(r.count).padEnd(6)}${r.user.expectScope}`,
    );
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Projects scope audit passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
