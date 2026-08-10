import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = "http://demo.localhost:3001";
const PW = "ControlDesk#2026";

const USERS = [
  { email: "admin@demo.controldesk.app",              role: "TENANT_ADMIN" },
  { email: "gm@demo.controldesk.app",                 role: "GENERAL_MANAGER" },
  { email: "hm@demo.controldesk.app",                 role: "HEAD_MANAGER" },
  { email: "om@demo.controldesk.app",                 role: "OPERATIONS_MANAGER" },
  { email: "pm@demo.controldesk.app",                 role: "PROJECT_MANAGER" },
  { email: "supervisor@demo.controldesk.app",         role: "SUPERVISOR" },
  { email: "employee@demo.controldesk.app",           role: "EMPLOYEE" },
  { email: "finance@demo.controldesk.app",            role: "LEAD_FINANCE" },
  { email: "hr@demo.controldesk.app",                 role: "HR_ADMIN" },
  { email: "pettycash@demo.controldesk.app",          role: "PETTY_CASH_CUSTODIAN" },
  { email: "director.canonical@demo.controldesk.app", role: "DIRECTOR" },
  { email: "finance.canonical@demo.controldesk.app",  role: "FINANCE" },
  { email: "pm.canonical@demo.controldesk.app",       role: "PM" },
];

const ROUTES = [
  "/dashboard", "/clients", "/projects", "/assignments", "/handovers", "/insights",
  "/finance/expenses", "/finance/cash-advances", "/finance/petty-cash",
  "/finance/budgets", "/finance/contracts", "/finance/budget-requests",
  "/approvals",
  "/hr/employees", "/hr/roster", "/hr/shifts", "/hr/timesheets", "/hr/requests",
  "/hr/performance", "/hr/upk", "/hr/payroll",
  "/reports",
  "/settings", "/settings/preferences", "/settings/users", "/settings/secrets",
  "/settings/lookups", "/settings/approval-thresholds", "/settings/features",
  "/settings/coa", "/settings/bulk-import", "/settings/integrations",
  "/settings/archives",
];

async function auditOne(user) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const result = { user: user.email, role: user.role, access: {} };
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector('input[type="email"]:not([disabled])', { timeout: 15000 });
    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', PW);
    await page.waitForSelector('button[type="submit"]:not([disabled])');
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 });

    for (const route of ROUTES) {
      try {
        const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        const finalUrl = page.url();
        const status = resp?.status() ?? 0;
        const forbidden = finalUrl.includes("error=forbidden");
        let verdict = "OK";
        if (forbidden) verdict = "FORBIDDEN";
        else if (status >= 400) verdict = `HTTP_${status}`;
        else if (!finalUrl.includes(route)) verdict = `REDIR→${new URL(finalUrl).pathname}`;
        result.access[route] = verdict;
      } catch (err) {
        result.access[route] = `ERR:${err.message.slice(0, 40)}`;
      }
    }
  } catch (err) {
    result.loginError = err.message.slice(0, 200);
  } finally {
    await browser.close();
  }
  return result;
}

console.log(`Auditing ${USERS.length} users × ${ROUTES.length} routes`);
const t0 = Date.now();
const results = [];
for (let i = 0; i < USERS.length; i++) {
  const u = USERS[i];
  const dt0 = Date.now();
  const r = await auditOne(u);
  const dt = ((Date.now() - dt0) / 1000).toFixed(1);
  const errCount = Object.values(r.access).filter((v) => typeof v === "string" && v.startsWith("ERR")).length;
  const status = r.loginError ? "LOGIN_FAIL" : `${errCount === 0 ? "OK" : errCount + " ERRs"}`;
  console.log(`  [${i + 1}/${USERS.length}] ${u.role.padEnd(24)} ${status.padEnd(12)} ${dt}s`);
  results.push(r);
  writeFileSync("/tmp/rbac-audit-v3.json", JSON.stringify({ users: results, routes: ROUTES }, null, 2));
}
console.log(`\nTotal: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
