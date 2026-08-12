import { expect, test as base, type Page } from "@playwright/test";

/**
 * Shared fixtures for ControlDesk E2E tests.
 *
 * `withRole` logs in via the password tab of `/login` (rules §21 test plan).
 * Credentials come from `supabase/seed.sql`.
 */

export const DEMO_PASSWORD = "ControlDesk#2026";

export const DEMO_USERS: Record<string, { email: string; name: string }> = {
  admin: { email: "admin@demo.controldesk.app", name: "Ayu Admin" },
  gm: { email: "gm@demo.controldesk.app", name: "Gita General" },
  hm: { email: "hm@demo.controldesk.app", name: "Hendra Head" },
  om: { email: "om@demo.controldesk.app", name: "Omar Operations" },
  pm: { email: "pm@demo.controldesk.app", name: "Putri PM" },
  pm2: { email: "pm2@demo.controldesk.app", name: "Prima PM2" },
  supervisor: {
    email: "supervisor@demo.controldesk.app",
    name: "Sinta Supervisor",
  },
  employee: { email: "employee@demo.controldesk.app", name: "Eko Employee" },
  finance: { email: "finance@demo.controldesk.app", name: "Fajar Finance" },
  hr: { email: "hr@demo.controldesk.app", name: "Hana HR" },
  pettycash: {
    email: "pettycash@demo.controldesk.app",
    name: "Pandu Petty",
  },
};

export type RoleKey = keyof typeof DEMO_USERS;

export async function loginAs(page: Page, role: RoleKey): Promise<void> {
  const user = DEMO_USERS[role];
  await page.goto("/login");

  // Password tab is default. The shadcn <FormLabel> isn't reliably resolved
  // by `getByLabel` because the input's accessible name is derived from its
  // placeholder. Target inputs by `type=` instead.
  await page.locator('input[type="email"]').first().fill(user.email);
  await page.locator('input[type="password"]').first().fill(DEMO_PASSWORD);

  const submit = page.getByRole("button", { name: /^(sign in|masuk)$/i });
  await Promise.all([
    // Generous timeout — Next.js dev server can spend >15s compiling
    // /dashboard on the very first login of a fresh session.
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 60_000,
    }),
    submit.click(),
  ]);

  await expect(page).toHaveURL(/\/dashboard(\/|$)?/i, { timeout: 60_000 });
}

export const test = base.extend({});
