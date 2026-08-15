#!/usr/bin/env tsx
/**
 * End-to-end smoke test for employee PII encryption (rules §3).
 *
 * Exercises the real Node crypto helpers against the running Supabase
 * DB — no mocking, no manual SQL. Proves the full round-trip through
 * migration 0094's constraints:
 *
 *   1. Encrypt NIK via `encryptEmployeePii` and blind-index-hash via
 *      `hashEmployeeNik` (namespaced by tenant_id).
 *   2. Insert a test employee row using `supabase-js` service_role
 *      client (same wire path as the Server Action).
 *   3. Read back, decrypt, assert plaintext round-trips.
 *   4. Attempt a duplicate insert with the SAME NIK → verify the
 *      `employees_tenant_nik_hash_uidx` unique constraint fires.
 *   5. Cleanup — hard-delete both rows.
 *
 * Usage:
 *   pnpm dlx tsx --tsconfig scripts/tsconfig.json scripts/pii-smoke.ts
 * Or via the wrapper:
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs \
 *     --tsconfig scripts/tsconfig.json scripts/pii-smoke.ts
 */

import { createClient } from "@supabase/supabase-js";

import {
  decryptEmployeePii,
  encryptEmployeePii,
  fromBytea,
  hashEmployeeNik,
  nikHashesEqual,
  toBytea,
} from "@/lib/security/employee-pii";

const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Load them via `.env.local` (--env-file).",
  );
  process.exit(2);
}

if (
  !process.env.APP_ENCRYPTION_KEY ||
  process.env.APP_ENCRYPTION_KEY.length < 32
) {
  console.error("APP_ENCRYPTION_KEY missing or too short (needs 32+ chars).");
  process.exit(2);
}

const supabase = createClient(
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

// Nonce-suffix to avoid collision with any lingering test rows from a
// previous run and to make cleanup deterministic.
const RUN_ID = Date.now().toString(36);
const TEST_NIK = "3201234567890" + RUN_ID.slice(-3).padStart(3, "0");
const TEST_EMAIL_A = `pii-smoke-${RUN_ID}-a@qa.controldesk.internal`;
const TEST_EMAIL_B = `pii-smoke-${RUN_ID}-b@qa.controldesk.internal`;

let failures = 0;
const pass = (msg: string) => console.log(`  \u2713 ${msg}`);
const fail = (msg: string, err?: unknown) => {
  failures += 1;
  console.error(`  \u2717 ${msg}`);
  if (err) console.error("    ", err);
};

async function pickTenant(): Promise<{ id: string; slug: string }> {
  // Prefer `itps` (the scratch tenant per rules §5 / migration seeds).
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug")
    .eq("slug", "itps")
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  // Fallback to whatever tenant exists first — this is a smoke script
  // so we don't care which tenant, only that the row-level constraints
  // scope correctly.
  const { data: any, error: anyErr } = await supabase
    .from("tenants")
    .select("id, slug")
    .limit(1)
    .maybeSingle();
  if (anyErr) throw anyErr;
  if (!any) throw new Error("No tenants exist — seed one first.");
  return any;
}

async function main() {
  console.log(`\n== employee PII smoke test (run ${RUN_ID}) ==`);
  console.log(`SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}`);

  const tenant = await pickTenant();
  console.log(`tenant     : ${tenant.slug} (${tenant.id})`);
  console.log(`test NIK   : ${TEST_NIK}\n`);

  // ── 1. Encrypt + hash locally.
  const nikEnc = encryptEmployeePii(TEST_NIK);
  const nikHash = hashEmployeeNik({ nik: TEST_NIK, tenantId: tenant.id });
  if (!nikEnc || !nikHash) {
    fail("encryptEmployeePii / hashEmployeeNik returned null");
    return;
  }
  if (!nikEnc.startsWith("v1.")) {
    fail(`nik_enc does not start with v1. (got: ${nikEnc.slice(0, 8)})`);
    return;
  }
  pass(`encrypted NIK to v1.<iv>.<ct>.<tag> shape (${nikEnc.length} chars)`);
  pass(`hashed NIK to ${nikHash.length}-byte HMAC blind index`);

  // ── 2. Insert row A via service_role — same path as Server Action.
  const { data: rowA, error: insertErrA } = await supabase
    .from("employees")
    .insert({
      tenant_id: tenant.id,
      first_name: "PII",
      last_name: "Smoke A",
      full_name: "PII Smoke A",
      email: TEST_EMAIL_A,
      role: "EMPLOYEE",
      join_date: new Date().toISOString().slice(0, 10),
      employment_type: "PERMANENT",
      availability: "AVAILABLE",
      is_active: true,
      nik_enc: nikEnc,
      // supabase-js JSON wire needs bytea as `\x<hex>` — the toBytea
      // helper is exactly this contract, tested in employee-pii.test.ts.
      nik_hash: toBytea(nikHash) as string,
    })
    .select("id, nik_enc, nik_hash")
    .single();
  if (insertErrA || !rowA) {
    fail("insert row A failed", insertErrA);
    return;
  }
  pass(`inserted employee A (id=${rowA.id.slice(0, 8)}…)`);

  // ── 3. Read back and verify the round-trip.
  const decrypted = decryptEmployeePii(rowA.nik_enc);
  if (decrypted !== TEST_NIK) {
    fail(`decrypt round-trip failed: got "${decrypted}", expected "${TEST_NIK}"`);
  } else {
    pass(`decryptEmployeePii round-trip matches plaintext`);
  }

  // ── 4. Compare hash from DB against the hash we computed locally.
  //    supabase-js returns bytea as `\x<hex>` — our fromBytea reverses it.
  const dbHash = fromBytea(rowA.nik_hash);
  if (!nikHashesEqual(dbHash, nikHash)) {
    fail("blind-index hash from DB does not match local hash");
  } else {
    pass(`blind-index hash from DB matches local hash (constant-time compare)`);
  }

  // ── 5. Attempt duplicate insert — MUST fail on the unique index.
  const { error: insertErrB } = await supabase
    .from("employees")
    .insert({
      tenant_id: tenant.id,
      first_name: "PII",
      last_name: "Smoke B",
      full_name: "PII Smoke B",
      email: TEST_EMAIL_B,
      role: "EMPLOYEE",
      join_date: new Date().toISOString().slice(0, 10),
      employment_type: "PERMANENT",
      availability: "AVAILABLE",
      is_active: true,
      nik_enc: encryptEmployeePii(TEST_NIK), // NEW ciphertext (fresh IV)
      nik_hash: toBytea(hashEmployeeNik({ nik: TEST_NIK, tenantId: tenant.id })) as string,
    });
  if (!insertErrB) {
    fail("duplicate NIK insert unexpectedly SUCCEEDED (unique constraint broken?)");
    // Best-effort cleanup of the phantom second row.
    await supabase.from("employees").delete().eq("email", TEST_EMAIL_B);
  } else if (
    insertErrB.code !== "23505" &&
    !/duplicate|unique/i.test(insertErrB.message)
  ) {
    fail(`duplicate insert failed but with unexpected error: ${insertErrB.code} ${insertErrB.message}`);
  } else {
    pass(
      `duplicate NIK blocked by unique constraint (${insertErrB.code} — ${insertErrB.message.split("\n")[0]})`,
    );
  }

  // ── 6. Cleanup.
  const { error: deleteErr } = await supabase
    .from("employees")
    .delete()
    .in("email", [TEST_EMAIL_A, TEST_EMAIL_B]);
  if (deleteErr) {
    fail("cleanup delete failed", deleteErr);
  } else {
    pass("cleaned up test rows");
  }

  console.log(
    failures === 0
      ? "\nresult: PASS \u2713 (all 5 assertions green)\n"
      : `\nresult: FAIL \u2717 (${failures} assertion(s) failed)\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("unhandled error:", err);
  process.exit(1);
});
