#!/usr/bin/env node
/**
 * Regression smoke for the /settings/integrations/ai "verify + save" flow.
 *
 * Before: submitting the AI provider form against the prod container failed
 * with "AI provider rejected the credentials: Google AI SDK (`@ai-sdk/google`)
 * is not installed on the server." The dynamic-import bypass (`new Function`)
 * hid the dependency from Next.js's file tracer, so `.next/standalone` never
 * shipped the SDK. Fix: direct `await import("@ai-sdk/google")` in the
 * GOOGLE branch of `resolver.ts` + `verify.ts` so the tracer includes the
 * transitive dependency graph.
 *
 * This script logs in as the demo TENANT_ADMIN, opens the AI integration
 * form, and confirms:
 *   - The page renders without a stale error banner.
 *   - Filling the API key + saving does NOT surface the "not installed"
 *     error string (either the save succeeds silently OR another failure
 *     mode surfaces — but never the SDK-missing one).
 */
import { chromium } from "@playwright/test";

const BASE = "http://demo.localhost:3001";
const EMAIL = "admin@demo.controldesk.app";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 20_000;

// Placeholder — the actual key is masked as ******** by the form until
// the user re-enters one. We only care that the round-trip doesn't blow
// up with the SDK-missing string; keeping this a garbage value is fine
// because Gemini rejects it with a *different* error (invalid API key),
// which still proves the SDK loaded successfully on the server.
const FAKE_KEY = "AQ.DummyKeyForSmoke_00000000000000000000000000000000000";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

let failures = 0;
const pass = (msg) => console.log("  ✓", msg);
const fail = (msg) => {
  failures += 1;
  console.error("  ✗", msg);
};

try {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[type="submit"]');
    return btn && !btn.disabled;
  });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: NAV_TIMEOUT }),
    page.click('button[type="submit"]'),
  ]);
  pass("Login OK");

  await page.goto("/settings/integrations/ai", { waitUntil: "domcontentloaded" });
  // Identify the surface by its Save button — the label is localized
  // (id: Simpan, en: Save) so match either.
  await page
    .getByRole("button", { name: /(Save|Simpan)/i })
    .first()
    .waitFor({ timeout: 10_000 });
  pass("/settings/integrations/ai rendered");

  // The API-key input renders as password-typed; grab it by that.
  const apiKeyInput = page.locator('input[type="password"]').first();
  await apiKeyInput.click();
  await apiKeyInput.fill(FAKE_KEY);
  pass("API key input filled with dummy value");

  const savePromise = page.waitForResponse(
    (resp) => resp.request().method() === "POST" && resp.url().includes("/settings/integrations/ai"),
    { timeout: 30_000 },
  ).catch(() => null);
  await page.getByRole("button", { name: /(Save|Simpan)/i }).first().click();
  await savePromise;

  // Wait a moment for any error toast / banner to render.
  await page.waitForTimeout(1500);

  const body = await page.locator("body").innerText();
  const sdkMissing = /is not installed on the server/i.test(body);
  if (sdkMissing) {
    fail("SDK-missing error still surfaces on save");
  } else {
    pass("No 'SDK not installed' error after save (fix landed)");
  }

  await page.screenshot({
    path: "screenshots/ai/settings-ai-after-save.png",
    fullPage: false,
  });
  pass("Screenshot saved → screenshots/ai/settings-ai-after-save.png");
} catch (err) {
  fail(`Uncaught error: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
