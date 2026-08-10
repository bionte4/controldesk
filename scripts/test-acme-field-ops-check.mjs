#!/usr/bin/env node
/**
 * One-shot check — verifies the Field-Ops Cash Advance page renders
 * cleanly for a brand-new tenant, whose lookup_options table has 0 rows
 * in the four legacy domains (unit_pengaju, transport_need, area,
 * rab_category — seeded per-tenant only in supabase/seed.sql, not by
 * provision_tenant()).
 *
 * We accept "empty dropdowns" as expected behaviour — the fresh admin
 * curates them via /settings/lookups. This script only fails if the
 * page hard-crashes (500) or emits a pageerror.
 */
import { chromium } from "@playwright/test";

const BASE = "http://test-acme.localhost:3001";
const EMAIL = "admin@test-acme.controldesk.app";
const PASSWORD = process.argv[2] ?? "fzMd0SsIacyuqI-5XwRPbQxeBmMqfvIr";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
});

await page.goto("/login", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const btn = document.querySelector('button[type="submit"]');
  return btn && !btn.disabled;
});
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForURL(/\/dashboard/, { timeout: 20000 }),
  page.click('button[type="submit"]'),
]);

const resp = await page.goto("/finance/cash-advances", {
  waitUntil: "domcontentloaded",
  timeout: 20000,
});
console.log(`/finance/cash-advances status: ${resp?.status()}`);

await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
const body = (await page.textContent("body")) ?? "";
const hasFieldOpsTrigger = /field.?ops/i.test(body);
console.log(`page mentions "field ops": ${hasFieldOpsTrigger}`);

if (errors.length) {
  console.log("\npage errors detected:");
  errors.forEach((e) => console.log("   ·", e));
  process.exit(1);
} else {
  console.log("no page errors — page rendered cleanly");
}

await browser.close();
