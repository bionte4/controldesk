import { execSync } from "node:child_process";

import { expect, test } from "@playwright/test";

/**
 * Fase 6.1 — Tenant self-signup end-to-end (docs/qa/local-multitenant-testing.md §Skenario C).
 *
 * Alur yang di-cover:
 *   1. Load /register-org di apex (bukan subdomain tenant).
 *   2. Submit form → server action `requestSignupAction`.
 *   3. Poll mailpit REST API untuk email verifikasi.
 *   4. Extract raw token dari email body → navigate ke /register-org/verify/{token}.
 *   5. Confirmation page render kredensial (URL login + password one-shot).
 *   6. Cleanup — hapus tenant + auth user + signup request via SQL.
 *
 * Prasyarat runtime:
 *   - Mailpit reachable di MAILPIT_URL (default http://localhost:8025).
 *   - Supabase local di :54322 (docker container `supabase_db_controldesk`).
 *   - App server di PLAYWRIGHT_APEX_URL (default http://localhost:3000).
 *
 * Test SKIP otomatis kalau mailpit tidak reachable — biar CI environment
 * tanpa mailpit tidak false-fail.
 *
 * NOTE ttg baseURL: playwright.config.ts default `demo.localhost:3000`
 * (untuk tenant-scoped E2E). Suite ini pakai APEX URL absolut karena
 * self-signup HANYA available di apex domain — pengecekan yang sengaja.
 */

const APEX_URL = process.env.PLAYWRIGHT_APEX_URL ?? "http://localhost:3000";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
const DB_CONTAINER =
  process.env.PW_SUPABASE_DB_CONTAINER ?? "supabase_db_controldesk";

// Unique per-run slug so multiple test runs don't collide + a stale row
// from a failed prior run doesn't block a fresh run.
function uniqueSlug(prefix = "pw-signup"): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${stamp}-${rand}`.toLowerCase().slice(0, 40);
}

// ---------------------------------------------------------------------------
// Mailpit REST helpers
// ---------------------------------------------------------------------------

type MailpitSummary = {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
};

type MailpitMessage = {
  Text: string;
  HTML: string;
  To: { Address: string }[];
  Subject: string;
};

async function mailpitReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MAILPIT_URL}/api/v1/info`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, {
    method: "DELETE",
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    /* best-effort */
  });
}

async function findMessageTo(
  toEmail: string,
  subjectMatch: RegExp,
  timeoutMs = 30_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listRes = await fetch(
      `${MAILPIT_URL}/api/v1/messages?limit=50`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (listRes.ok) {
      const list = (await listRes.json()) as {
        messages: MailpitSummary[];
      };
      const hit = list.messages.find(
        (m) =>
          m.To.some((t) => t.Address.toLowerCase() === toEmail.toLowerCase()) &&
          subjectMatch.test(m.Subject),
      );
      if (hit) {
        const detailRes = await fetch(
          `${MAILPIT_URL}/api/v1/message/${hit.ID}`,
          { signal: AbortSignal.timeout(3000) },
        );
        if (detailRes.ok) {
          return (await detailRes.json()) as MailpitMessage;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(
    `Timeout waiting for email to ${toEmail} matching ${subjectMatch}`,
  );
}

function extractVerifyUrl(body: string): string {
  const match = body.match(
    /https?:\/\/[^\s]+\/register-org\/verify\/[A-Za-z0-9_-]+/,
  );
  if (!match) {
    throw new Error(
      `No /register-org/verify/... URL found in email body:\n${body.slice(0, 500)}`,
    );
  }
  return match[0];
}

// ---------------------------------------------------------------------------
// Direct DB cleanup (bypass RLS via service_role docker exec)
// ---------------------------------------------------------------------------

function sqlExec(sql: string): string {
  // Single-line SQL passed via -c to keep escaping simple.
  const oneLine = sql.replace(/\s+/g, " ").trim();
  return execSync(
    `docker exec ${DB_CONTAINER} psql -U postgres -d postgres -tAc "${oneLine.replace(/"/g, '\\"')}"`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function cleanupTenantBySlug(slug: string): void {
  try {
    // Get the tenant id + admin auth user id (if the tenant made it that far)
    const tenantId = sqlExec(
      `select id from public.tenants where slug = '${slug}' limit 1;`,
    );
    if (tenantId) {
      const adminUserId = sqlExec(
        `select user_id from public.employees where tenant_id = '${tenantId}' and role = 'TENANT_ADMIN' limit 1;`,
      );
      // Bypass triggers so cascading trigger side effects don't slow
      // the cleanup down or block on FK reference audit logs.
      sqlExec(`
        begin;
        set session_replication_role = replica;
        delete from public.tenants where id = '${tenantId}';
        ${adminUserId ? `delete from auth.users where id = '${adminUserId}';` : ""}
        set session_replication_role = default;
        commit;
      `);
    }
    // Always clean the signup request row too.
    sqlExec(`delete from public.tenant_signup_requests where slug = '${slug}';`);
  } catch (err) {
    // Cleanup is best-effort — surface the failure in the test log but
    // don't throw, otherwise afterAll masks the actual test failure.
    console.warn(`[cleanup] ${slug}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("tenant self-signup — /register-org (Fase 6.1)", () => {
  const createdSlugs: string[] = [];

  test.beforeAll(async () => {
    const up = await mailpitReachable();
    test.skip(
      !up,
      `Mailpit not reachable at ${MAILPIT_URL} — skipping self-signup E2E. ` +
        `Start it via docker-compose: docker compose up -d mailpit`,
    );
    await clearMailpit();
  });

  test.afterAll(() => {
    for (const slug of createdSlugs) {
      cleanupTenantBySlug(slug);
    }
  });

  test("happy path: form → email → verify → confirmation shows credentials", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const slug = uniqueSlug();
    createdSlugs.push(slug);
    const adminEmail = `${slug}@example.test`;
    const adminName = "E2E Tester";
    const orgName = `PT E2E ${slug}`;

    // --- Step 1: form submission ---
    await page.goto(`${APEX_URL}/register-org`);
    await expect(
      page.getByRole("heading", { name: /daftar workspace baru/i }),
    ).toBeVisible();

    await page.locator('input[name="name"]').fill(orgName);
    await page.locator('input[name="slug"]').fill(slug);
    await page.locator('input[name="admin_email"]').fill(adminEmail);
    await page.locator('input[name="admin_name"]').fill(adminName);

    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes("/register-org"),
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: /daftar & kirim link/i }).click(),
    ]);

    await expect(
      page.getByRole("heading", { name: /periksa email anda/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(adminEmail)).toBeVisible();

    // --- Step 2: fetch verification email from mailpit ---
    const verifyMail = await findMessageTo(
      adminEmail,
      /Konfirmasi pendaftaran/i,
    );
    const verifyUrl = extractVerifyUrl(verifyMail.Text || verifyMail.HTML);
    expect(verifyUrl).toContain("/register-org/verify/");

    // --- Step 3: click verify → confirmation page ---
    await page.goto(verifyUrl);

    // RSC path: on success the /verify/[token] page renders the
    // VerifyResultView client component which then history.replaceState()
    // to /register-org/confirm?slug=... — assert the final state.
    // Heading format: "Workspace {tenant_name} siap"
    await expect(
      page.getByRole("heading", {
        name: new RegExp(`Workspace .*${orgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} siap`, "i"),
      }),
    ).toBeVisible({ timeout: 30_000 });

    // URL scrubbed — token should NOT be visible in the address bar.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 5_000 })
      .toMatch(/\/register-org\/confirm/);

    // Credentials block rendered exactly once — assert email + password
    // shown, and a login URL that points at the fresh tenant subdomain.
    await expect(page.getByText(adminEmail).first()).toBeVisible();
    await expect(page.getByText(`${slug}.`)).toBeVisible();

    // --- Step 4: confirmation email sent ---
    const confirmMail = await findMessageTo(
      adminEmail,
      /Workspace .* siap/i,
    );
    // Email body should reference the tenant subdomain URL (host varies
    // between local dev / staging / prod — assert the slug appears with
    // the trailing `.` marking a subdomain boundary).
    const body = confirmMail.Text || confirmMail.HTML;
    expect(body).toContain(`${slug}.`);
    expect(body).toContain(adminEmail);
  });

  test("rejects reserved slug (does not create any DB row)", async ({
    page,
  }) => {
    await page.goto(`${APEX_URL}/register-org`);
    await page.locator('input[name="name"]').fill("PT Should Fail");
    await page.locator('input[name="slug"]').fill("www"); // reserved
    await page.locator('input[name="admin_email"]').fill("nope@example.test");
    await page.locator('input[name="admin_name"]').fill("Nobody");

    await page.getByRole("button", { name: /daftar & kirim link/i }).click();

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    // The form should STILL be there — no confirmation screen.
    await expect(
      page.getByRole("heading", { name: /periksa email anda/i }),
    ).toHaveCount(0);

    // No DB row should have been inserted with slug='www' (defense in depth
    // — the DB check constraint would also reject it, but we want to prove
    // the server action blocked BEFORE the DB call).
    const row = sqlExec(
      `select count(*) from public.tenant_signup_requests where slug = 'www';`,
    );
    expect(row).toBe("0");
  });

  test("rejects malformed slug at client (form validation)", async ({
    page,
  }) => {
    await page.goto(`${APEX_URL}/register-org`);
    await page.locator('input[name="name"]').fill("PT Bad Slug");
    await page.locator('input[name="slug"]').fill("BAD SLUG!!"); // uppercase + spaces
    await page.locator('input[name="admin_email"]').fill("bad@example.test");
    await page.locator('input[name="admin_name"]').fill("Bad User");

    await page.getByRole("button", { name: /daftar & kirim link/i }).click();

    // Server-side validation surfaces via role=alert with the field name
    // ("slug: ..."). Either the server responds with that alert, or the
    // browser blocks submission entirely via HTML5 validation on other
    // fields — assert we don't reach the confirmation screen.
    await expect(
      page.getByRole("heading", { name: /periksa email anda/i }),
    ).toHaveCount(0);
  });
});
