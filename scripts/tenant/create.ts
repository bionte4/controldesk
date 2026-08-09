/**
 * ControlDesk — `pnpm tenant:create` CLI.
 *
 * Automates the manual SQL runbook in docs/ops/tenant-provisioning.md
 * into a single command. Combines:
 *
 *   1. Preflight validation (slug regex, reserved list, uniqueness,
 *      email uniqueness in auth.users).
 *   2. Auth user creation via Supabase Admin API (`auth.admin.createUser`).
 *   3. Atomic DB provisioning via `public.provision_tenant()` RPC
 *      (migration 0076 — tenants row + CoA seed + TENANT_ADMIN
 *      employee + audit log, all in one transaction).
 *   4. Rollback on failure — if the RPC fails after step 2, the auth
 *      user is deleted so re-runs don't collide on unique email.
 *   5. Prints a copy-paste-ready welcome email to stdout for the
 *      operator to send manually (no SMTP dependency in the CLI).
 *
 * Why no SMTP send inside the CLI: the mailer module lives in
 * server-only code, and getting it working in a `tsx` script would
 * couple this tool to Next.js runtime. Explicit "operator copies
 * password out of terminal and sends via preferred channel" is also
 * safer — prevents a broken SMTP config from silently misfiring the
 * credentials to a wrong address.
 *
 * Exit codes:
 *   0  success
 *   1  runtime failure (DB, auth, unexpected)
 *   2  usage error / validation failure (argv, env, preflight)
 */

import { createClient } from "@supabase/supabase-js";

import {
  PROVISIONING_USAGE,
  generateSecurePassword,
  parseProvisioningArgs,
  renderWelcomeEmail,
  type ParsedProvisioningArgs,
} from "@/lib/ops/tenant-provisioning";
import type { Database } from "@/types/database";

type ExitCode = 0 | 1 | 2;

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function warn(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function die(msg: string, code: ExitCode = 1): never {
  warn(msg);
  process.exit(code);
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    die(`env ${key} is not set. Add it to .env.local (see docs/ops/tenant-provisioning.md).`, 2);
  }
  return v;
}

async function confirmInteractive(question: string): Promise<boolean> {
  // Node's readline import is cheap and dependency-free. Keep it dynamic
  // so tests that stub this file don't drag in stdin.
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

type ServiceClient = ReturnType<typeof createClient<Database>>;

function serviceClient(): ServiceClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function preflight(
  supa: ServiceClient,
  args: ParsedProvisioningArgs,
): Promise<void> {
  const existingTenant = await supa
    .from("tenants")
    .select("id, slug")
    .eq("slug", args.slug)
    .maybeSingle();
  if (existingTenant.error) {
    die(`Preflight: cannot query tenants table: ${existingTenant.error.message}`, 1);
  }
  if (existingTenant.data) {
    die(
      `Preflight: tenant with slug '${args.slug}' already exists (id=${existingTenant.data.id}). Pick another slug or delete the existing tenant first.`,
      2,
    );
  }

  const authAdmin = supa.auth.admin;
  // listUsers paginates; we filter client-side because Supabase Admin
  // API doesn't expose a direct email lookup. Cap at 1000 (default
  // page size) — realistic tenants stay well below this.
  const usersPage = await authAdmin.listUsers({ page: 1, perPage: 1000 });
  if (usersPage.error) {
    die(`Preflight: cannot list auth users: ${usersPage.error.message}`, 1);
  }
  const clash = usersPage.data.users.find(
    (u) => u.email?.toLowerCase() === args.adminEmail,
  );
  if (clash) {
    die(
      `Preflight: auth user with email '${args.adminEmail}' already exists (id=${clash.id}). If this user should belong to the new tenant, use a different provisioning flow (multi-tenant users are not supported by this CLI).`,
      2,
    );
  }
}

async function createAuthUser(
  supa: ServiceClient,
  args: ParsedProvisioningArgs,
  password: string,
): Promise<string> {
  const res = await supa.auth.admin.createUser({
    email: args.adminEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: args.adminName },
    app_metadata: { provisioned_by: args.source, provisioned_at: new Date().toISOString() },
  });
  if (res.error || !res.data.user) {
    die(
      `Failed to create auth user: ${res.error?.message ?? "no user returned"}`,
      1,
    );
  }
  return res.data.user.id;
}

async function callProvisionRpc(
  supa: ServiceClient,
  args: ParsedProvisioningArgs,
  adminUserId: string,
): Promise<{ tenantId: string; employeeId: string }> {
  // The generated Database types don't include provision_tenant until
  // `pnpm db:types` is re-run after applying migration 0076. Cast
  // through unknown so the call compiles regardless of the current
  // types snapshot — the SQL contract is stable.
  const rpcFn = supa.rpc.bind(supa) as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const res = await rpcFn("provision_tenant", {
    p_slug: args.slug,
    p_name: args.name,
    p_admin_user_id: adminUserId,
    p_admin_email: args.adminEmail,
    p_admin_name: args.adminName,
    p_source: args.source,
  });

  if (res.error) {
    throw new Error(res.error.message);
  }

  const rows = res.data as
    | Array<{ tenant_id: string; employee_id: string }>
    | { tenant_id: string; employee_id: string }
    | null;

  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.tenant_id || !row.employee_id) {
    throw new Error("provision_tenant RPC returned empty rowset");
  }
  return { tenantId: row.tenant_id, employeeId: row.employee_id };
}

async function rollbackAuthUser(
  supa: ServiceClient,
  userId: string,
): Promise<void> {
  const res = await supa.auth.admin.deleteUser(userId);
  if (res.error) {
    warn(
      `WARN: rollback delete of auth user ${userId} failed: ${res.error.message}. Delete manually via Supabase Studio to avoid a dangling row.`,
    );
  }
}

async function seedCoaFallback(
  supa: ServiceClient,
  tenantId: string,
): Promise<void> {
  // provision_tenant already calls seed_default_coa. This is only
  // invoked when --skip-coa was NOT set but the CoA count check below
  // produced fewer accounts than expected — kept as a defensive net.
  const rpcFn = supa.rpc.bind(supa) as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const res = await rpcFn("seed_default_coa", { p_tenant: tenantId });
  if (res.error) {
    warn(`WARN: seed_default_coa fallback failed: ${res.error.message}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    log(PROVISIONING_USAGE);
    process.exit(argv.length === 0 ? 2 : 0);
  }

  const parsed = parseProvisioningArgs(argv);
  if (!parsed.ok) {
    warn(`Usage error: ${parsed.error.message}`);
    warn("");
    warn(PROVISIONING_USAGE);
    process.exit(2);
  }
  const args = parsed.value;

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "controldesk.app";
  const password = args.adminPassword ?? generateSecurePassword();
  const passwordGenerated = args.adminPassword === null;

  log("=".repeat(72));
  log("ControlDesk — tenant provisioning");
  log("=".repeat(72));
  log(`Slug         : ${args.slug}`);
  log(`Name         : ${args.name}`);
  log(`Admin email  : ${args.adminEmail}`);
  log(`Admin name   : ${args.adminName}`);
  log(`Password     : ${passwordGenerated ? "(auto-generated, shown at the end)" : "(provided via --admin-password)"}`);
  log(`Login URL    : https://${args.slug}.${rootDomain}/login`);
  log(`Source       : ${args.source}`);
  log(`Dry run      : ${args.dryRun ? "YES — no writes will happen" : "no"}`);
  log(`Skip CoA     : ${args.skipCoa ? "YES" : "no"}`);
  log("");

  const supa = serviceClient();

  log("[1/5] Preflight — checking slug + email uniqueness…");
  await preflight(supa, args);
  log("      OK");

  if (args.dryRun) {
    log("");
    log("Dry run — stopping before mutation. No auth user, no DB rows created.");
    process.exit(0);
  }

  if (!args.yes) {
    log("");
    const ok = await confirmInteractive("Proceed with provisioning?");
    if (!ok) {
      log("Cancelled.");
      process.exit(0);
    }
  }

  log("");
  log("[2/5] Creating auth user via Supabase Admin API…");
  const adminUserId = await createAuthUser(supa, args, password);
  log(`      auth.users.id = ${adminUserId}`);

  log("[3/5] Calling public.provision_tenant() RPC (atomic tx)…");
  let tenantId: string;
  let employeeId: string;
  try {
    const res = await callProvisionRpc(supa, args, adminUserId);
    tenantId = res.tenantId;
    employeeId = res.employeeId;
  } catch (err) {
    warn(`      FAILED: ${err instanceof Error ? err.message : String(err)}`);
    warn("      Rolling back auth user…");
    await rollbackAuthUser(supa, adminUserId);
    warn("      Rollback complete. Nothing was left behind (unless the WARN above says otherwise).");
    process.exit(1);
  }
  log(`      tenants.id   = ${tenantId}`);
  log(`      employees.id = ${employeeId}`);

  if (args.skipCoa) {
    log("[4/5] Skipping CoA seed (--skip-coa).");
  } else {
    log("[4/5] Verifying Chart of Accounts…");
    const { count, error } = await supa
      .from("chart_of_accounts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (error) {
      warn(`      WARN: could not verify CoA count: ${error.message}`);
    } else if ((count ?? 0) < 30) {
      warn(`      WARN: CoA seed produced only ${count} accounts. Re-running seed_default_coa…`);
      await seedCoaFallback(supa, tenantId);
    } else {
      log(`      OK — ${count} accounts seeded.`);
    }
  }

  log("[5/5] Provisioning complete.");
  log("");
  log("=".repeat(72));
  log("Next step — send this to the Tenant Admin");
  log("=".repeat(72));
  const email = renderWelcomeEmail({
    tenantName: args.name,
    tenantSlug: args.slug,
    adminName: args.adminName,
    adminEmail: args.adminEmail,
    adminPassword: password,
    rootDomain,
  });
  log(`Subject: ${email.subject}`);
  log("");
  log(email.body);
  log("");
  log("=".repeat(72));
  log("Reminder: DNS must resolve *.controldesk.app to the app for prod.");
  log("For dev: {slug}.localhost:3001 works out of the box.");
  log("=".repeat(72));
}

main().catch((err) => {
  warn(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
