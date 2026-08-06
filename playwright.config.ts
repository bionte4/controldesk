import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for ControlDesk critical-flow smoke tests.
 *
 * Runs against a local Next.js server. Assumes:
 *   1. `pnpm dev` (or a running production build) is up on
 *      http://demo.localhost:3000 — see `proxy.ts` for subdomain routing.
 *   2. Supabase local is running and seed data is applied.
 *
 * If neither is available, `PLAYWRIGHT_BASE_URL` can override the base URL.
 */
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://demo.localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  // Larger cap accommodates cold Next.js dev-server compiles for the first
  // navigation to each route. Individual tests still fail fast on assertions.
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    testIdAttribute: "data-testid",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
