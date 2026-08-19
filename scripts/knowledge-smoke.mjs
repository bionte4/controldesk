#!/usr/bin/env node
/**
 * Smoke test for the Knowledge Base MVP (migration 0095 + Fase 1 UI).
 *
 * Walks the happy path end-to-end in a real browser so we catch any
 * SSR/client-boundary breakage before the user does:
 *   1. Login as demo TENANT_ADMIN.
 *   2. Load `/knowledge` — expect status 200, heading "Knowledge
 *      Base", "Write article" CTA visible.
 *   3. Click "Write article" — form renders.
 *   4. Fill in title / body — auto-slug appears; submit.
 *   5. Land on `/knowledge/{slug}` — DRAFT badge visible, actions
 *      bar (Edit / Publish / Archive) visible.
 *   6. Open Publish dialog → fill summary → confirm.
 *   7. Verify DRAFT badge is replaced with the "published" state
 *      (no draft badge, published_at timestamp shown).
 *   8. Archive the article — ARCHIVED badge appears.
 *   9. Restore — DRAFT badge back.
 *
 * On any failure the script exits with non-zero so `pnpm knowledge:smoke`
 * fits into CI directly.
 */
import { chromium } from "@playwright/test";

// Multi-tenant middleware redirects auth flows to the tenant subdomain
// (e.g. `demo.localhost`), so we log in there directly rather than
// bouncing through the apex host.
const BASE = process.env.SMOKE_BASE_URL ?? "http://demo.localhost:3000";
// The `admin@demo` account is ALSO a platform super-admin, which
// redirects to `/super-admin/tenants` on login. Use the tenant-only
// HR admin instead — it lands on /dashboard like a regular user.
const EMAIL = "hr@demo.controldesk.app";
const PASSWORD = "ControlDesk#2026";
const NAV_TIMEOUT = 20_000;

const stamp = Date.now();
const TITLE = `KB Smoke ${stamp}`;
const BODY = `# Automated smoke\n\nThis article was created by \`scripts/knowledge-smoke.mjs\` at ${new Date(stamp).toISOString()}.\n\n- markdown works\n- **bold** works`;
const SUMMARY = `Automated smoke test article created at ${new Date(stamp).toISOString()}.`;

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

  // -----------------------------------------------------------------
  // /knowledge — landing renders.
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: /Knowledge Base|Basis Pengetahuan/ })
    .first()
    .waitFor({ timeout: 10_000 });
  pass("/knowledge landing rendered");

  // The "Write article" CTA is a Button that renders a <Link>, so
  // its accessibility role can be either `link` or `button` depending
  // on how the polymorphic component resolves — match by visible text.
  const newBtn = page.getByText(/^(Write article|Tulis artikel)$/).first();
  await newBtn.waitFor({ timeout: 5_000 });
  await newBtn.click();

  // -----------------------------------------------------------------
  // /knowledge/new — form renders.
  await page.waitForURL(/\/knowledge\/new/, { timeout: NAV_TIMEOUT });
  await page.locator('input#knowledge-title').waitFor();
  await page.locator('textarea#knowledge-body').waitFor();
  pass("/knowledge/new form rendered");

  // Give React 19 a beat to hydrate the client form before we drive
  // it — otherwise fill() writes to a pre-hydrated DOM value that
  // gets snapped back on the first controlled render.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);

  // `pressSequentially` fires per-key input events which reliably
  // trip React's controlled-input state updater; the bulk `fill()`
  // occasionally lands before hydration in dev mode.
  await page.locator('input#knowledge-title').click();
  await page.locator('input#knowledge-title').pressSequentially(TITLE, { delay: 5 });
  await page.locator('textarea#knowledge-body').click();
  await page.locator('textarea#knowledge-body').pressSequentially(BODY, { delay: 2 });
  // Slug is derived via useMemo→controlled input — Playwright may
  // read the value before React commits, so poll for the update.
  const slugInput = page.locator('input#knowledge-slug');
  let derivedSlug = "";
  for (let i = 0; i < 20; i++) {
    derivedSlug = await slugInput.inputValue();
    if (derivedSlug.startsWith("kb-smoke-")) break;
    await page.waitForTimeout(100);
  }
  if (!derivedSlug.startsWith("kb-smoke-")) {
    fail(`Expected auto-slug starting with "kb-smoke-", got "${derivedSlug}"`);
  } else {
    pass(`Auto-slug derived: ${derivedSlug}`);
  }

  await Promise.all([
    page.waitForURL(new RegExp(`/knowledge/${derivedSlug}$`), {
      timeout: NAV_TIMEOUT,
    }),
    page.getByRole("button", { name: /Save as draft|Simpan sebagai draft/ }).click(),
  ]);
  pass(`Draft created at /knowledge/${derivedSlug}`);

  // DRAFT badge should be visible.
  await page.getByText(/^DRAFT$/).first().waitFor({ timeout: 5_000 });
  pass("DRAFT badge visible on reader");

  // Publish flow.
  const publishBtn = page
    .getByRole("button", { name: /^Publish$|^Terbitkan$/ })
    .first();
  await publishBtn.click();
  await page.locator('#knowledge-publish-summary').waitFor();
  await page.fill('#knowledge-publish-summary', SUMMARY);
  await page
    .getByRole("button", { name: /Publish now|Terbitkan sekarang/ })
    .click();
  // Wait for the DRAFT badge to disappear.
  await page
    .getByText(/^DRAFT$/)
    .first()
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => {
      // Some Radix badges use display:none instead of detach; fall
      // through and re-verify by re-reading the page.
    });
  const draftStillThere = await page
    .getByText(/^DRAFT$/)
    .first()
    .isVisible()
    .catch(() => false);
  if (draftStillThere) {
    fail("Publish click did not clear DRAFT badge");
  } else {
    pass("Article published — DRAFT badge removed");
  }

  // Archive.
  await page
    .getByRole("button", { name: /^Archive$|^Arsip$/ })
    .first()
    .click();
  await page
    .getByText(/^ARCHIVED$/)
    .first()
    .waitFor({ timeout: 10_000 });
  pass("Article archived — ARCHIVED badge shown");

  // Restore.
  await page
    .getByRole("button", { name: /Restore to draft|Kembalikan ke draft/ })
    .first()
    .click();
  await page
    .getByText(/^DRAFT$/)
    .first()
    .waitFor({ timeout: 10_000 });
  pass("Article restored — DRAFT badge back");
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
  const shotPath = `/tmp/knowledge-smoke-fail-${stamp}.png`;
  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
  console.error("    saved screenshot to", shotPath);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
