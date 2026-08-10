#!/usr/bin/env node
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = "admin@demo.controldesk.app";
const PASSWORD = "ControlDesk#2026";
const OUT_DIR = "screenshots/super-admin";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return btn && !btn.disabled;
    },
    { timeout: 30_000 },
  );
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/(dashboard|super-admin)/, { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);

  await page.goto(`${BASE}/super-admin`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/tenants-list.png`, fullPage: true });
  console.log("saved:", `${OUT_DIR}/tenants-list.png`);

  await page.goto(`${BASE}/super-admin/tenants/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/tenants-new.png`, fullPage: true });
  console.log("saved:", `${OUT_DIR}/tenants-new.png`);

  await ctx.close();
  await browser.close();
})();
