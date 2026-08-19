#!/usr/bin/env node
/**
 * Bootstrap AI endpoint URLs for the current environment.
 *
 * ## Why this script exists
 *
 * `tenant_ai_configs.base_url` is a per-tenant column that hardcodes
 * the URL of the LLM endpoint (Groq public, OpenAI, self-hosted
 * Ollama, LM Studio, …). When multiple developers or CI/CD stages
 * share the same seed data, the value drifts against reality:
 *
 *   • `pnpm dev` on host wants `http://localhost:11434/v1` to reach
 *     an Ollama instance running natively on the machine.
 *   • The same repo mounted inside a Docker container wants
 *     `http://host.docker.internal:11434/v1` — the loopback name
 *     Docker Desktop injects into the container's DNS.
 *   • A VPS with Ollama on the same host uses `localhost:11434/v1`
 *     again, but Compose-based deploys with a sidecar container want
 *     the service name (e.g. `http://ollama:11434/v1`).
 *
 * Result: developers regularly hit "AI didn't reply" because the DB
 * still holds the previous environment's URL. This script detects
 * which candidate is actually reachable and (optionally) rewrites
 * the DB rows to match.
 *
 * ## What it touches
 *
 * ONLY `tenant_ai_configs` rows where:
 *   • `provider = 'OPENAI_COMPATIBLE'` (the Ollama / LM Studio /
 *     Groq-compat family — anything using the OpenAI Chat Completions
 *     protocol against a configurable `base_url`), AND
 *   • Current `base_url` looks like a private-network target
 *     (`localhost`, `127.*`, `host.docker.internal`, or explicit port
 *     `:11434`). Public cloud URLs are left alone even when reachable
 *     — the URL IS the config for those.
 *
 * Cloud provider rows (`GOOGLE`, `OPENAI`, `ANTHROPIC`) are ignored
 * entirely: their endpoints are fixed by the SDK, not configurable.
 *
 * ## Usage
 *
 *   pnpm ai:check                    # probe + report, no writes (default)
 *   pnpm ai:apply                    # commit changes
 *   pnpm ai:check --verbose          # show every probe attempt
 *   AI_BOOTSTRAP_TARGET_URL=http://custom:11434/v1 pnpm ai:apply
 *                                    # skip probe, use exact URL
 *
 * ## Safety
 *
 *   • Default mode is dry-run — you always see the plan before
 *     mutating the DB.
 *   • If NO candidate URL is reachable, the script refuses to write
 *     anything (better a stale config than a broken one).
 *   • Idempotent: applying twice is a no-op after the first run.
 *   • Reversible: the previous URL is logged before each UPDATE so
 *     the operator can roll back manually if needed.
 */

import { createClient } from "@supabase/supabase-js";

const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "   Load them via .env.local:\n" +
      "     node --env-file=.env.local scripts/bootstrap-ai-endpoints.mjs\n" +
      "   Or use the pnpm wrapper: `pnpm ai:check`.",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERBOSE = args.includes("--verbose") || args.includes("-v");
const OVERRIDE_URL = process.env.AI_BOOTSTRAP_TARGET_URL?.trim() || null;

/**
 * Candidate URLs to probe, in preference order. First one that
 * responds to `GET /api/tags` within `PROBE_TIMEOUT_MS` wins.
 *
 * `/api/tags` is Ollama's native "list models" endpoint — cheap
 * (no LLM invocation), universally available, and returns JSON we
 * can sanity-check. LM Studio also exposes it. For non-Ollama
 * OpenAI-compat servers, `/v1/models` would be more portable, but
 * Ollama's `/v1/models` is a thin wrapper that always resolves to
 * the same underlying `/api/tags` list — so probing the shorter
 * path keeps setup simpler.
 */
const CANDIDATES = OVERRIDE_URL
  ? [OVERRIDE_URL]
  : [
      "http://localhost:11434/v1",
      "http://127.0.0.1:11434/v1",
      "http://host.docker.internal:11434/v1",
    ];

const PROBE_TIMEOUT_MS = 3_000;

/**
 * Regex for URLs we consider "loopback-ish" — safe to mutate. Public
 * cloud hostnames (api.groq.com, api.openai.com, etc.) never match,
 * so they stay untouched even if a probe succeeds.
 */
const LOOPBACK_PATTERN =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|host\.docker\.internal|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?\//;

const supabase = createClient(
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * Probe an Ollama-family endpoint. Returns `{ ok, latencyMs,
 * modelCount }` on success, `{ ok: false, reason }` on failure.
 *
 * We STRIP the `/v1` suffix before hitting `/api/tags` because
 * that endpoint lives on the root path, not under the OpenAI-compat
 * mount. The DB column stores the OpenAI-compat prefix
 * (`http://.../v1`) that the AI SDK expects — this is a Ollama
 * convention quirk, not a portable protocol.
 */
async function probeEndpoint(baseUrl) {
  const root = baseUrl.replace(/\/v1\/?$/, "");
  const tagsUrl = `${root}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(tagsUrl, {
      method: "GET",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, latencyMs };
    const body = await res.json().catch(() => null);
    const modelCount = Array.isArray(body?.models) ? body.models.length : null;
    return { ok: true, latencyMs, modelCount };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const reason =
      err?.name === "AbortError"
        ? `timeout after ${PROBE_TIMEOUT_MS}ms`
        : err?.message || String(err);
    return { ok: false, reason, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverTargetUrl() {
  console.log(
    OVERRIDE_URL
      ? `→ AI_BOOTSTRAP_TARGET_URL override: ${OVERRIDE_URL}`
      : `→ Probing ${CANDIDATES.length} candidate URL(s)…`,
  );

  for (const url of CANDIDATES) {
    const result = await probeEndpoint(url);
    if (VERBOSE || result.ok) {
      const badge = result.ok ? "✅" : "  ";
      const detail = result.ok
        ? `(${result.latencyMs}ms${
            result.modelCount != null ? `, ${result.modelCount} models` : ""
          })`
        : `(${result.reason})`;
      console.log(`   ${badge} ${url} ${detail}`);
    }
    if (result.ok) return { url, ...result };
  }
  return null;
}

async function loadCandidateRows() {
  const { data, error } = await supabase
    .from("tenant_ai_configs")
    .select("tenant_id, provider, model_id, base_url, is_active")
    .eq("provider", "OPENAI_COMPATIBLE");
  if (error) {
    console.error("❌ Failed to load tenant_ai_configs:", error.message);
    process.exit(1);
  }
  // Join tenant slug for readable output.
  const tenantIds = data.map((r) => r.tenant_id);
  const { data: tenants, error: tErr } = await supabase
    .from("tenants")
    .select("id, slug, name")
    .in("id", tenantIds);
  if (tErr) {
    console.error("❌ Failed to load tenants:", tErr.message);
    process.exit(1);
  }
  const byId = new Map(tenants.map((t) => [t.id, t]));
  return data.map((r) => ({
    ...r,
    tenant_slug: byId.get(r.tenant_id)?.slug ?? "(unknown)",
    tenant_name: byId.get(r.tenant_id)?.name ?? "(unknown)",
  }));
}

function classify(row, targetUrl) {
  const current = row.base_url ?? "";
  if (!LOOPBACK_PATTERN.test(current)) {
    return { action: "skip", reason: "not a loopback/private URL" };
  }
  if (current === targetUrl) {
    return { action: "skip", reason: "already correct" };
  }
  return { action: "update", newUrl: targetUrl };
}

async function applyUpdate(row, newUrl) {
  const { error } = await supabase
    .from("tenant_ai_configs")
    .update({
      base_url: newUrl,
      last_error: null, // clear stale connection errors from previous URL
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", row.tenant_id);
  if (error) throw new Error(error.message);
}

function padRight(str, n) {
  return String(str).slice(0, n).padEnd(n, " ");
}

async function main() {
  console.log("── Bootstrap AI endpoints ─────────────────────────────────");
  console.log(`   Mode: ${APPLY ? "APPLY (writes to DB)" : "CHECK (dry run)"}`);
  console.log(`   Supabase: ${NEXT_PUBLIC_SUPABASE_URL}`);
  console.log("");

  const target = await discoverTargetUrl();
  if (!target) {
    console.log("");
    console.log(
      "❌ No candidate URL responded to a probe within " +
        `${PROBE_TIMEOUT_MS}ms.`,
    );
    console.log(
      "   Is Ollama running? Try `ollama serve` (or `brew services start ollama`).",
    );
    console.log(
      "   For non-default endpoints, set AI_BOOTSTRAP_TARGET_URL and re-run.",
    );
    process.exit(1);
  }

  console.log("");
  console.log(`→ Target URL adopted: ${target.url}`);
  console.log("");

  const rows = await loadCandidateRows();
  if (rows.length === 0) {
    console.log(
      "ℹ  No OPENAI_COMPATIBLE tenants found — nothing to do.",
    );
    console.log(
      "   (Cloud providers like GOOGLE/OPENAI/ANTHROPIC use fixed URLs.)",
    );
    return;
  }

  console.log(`→ ${rows.length} OPENAI_COMPATIBLE tenant(s) inspected:`);
  console.log("");
  console.log(
    "   " +
      padRight("SLUG", 14) +
      padRight("STATUS", 26) +
      padRight("MODEL", 22) +
      "CURRENT → NEW",
  );
  console.log("   " + "─".repeat(90));

  const plan = [];
  for (const row of rows) {
    const decision = classify(row, target.url);
    plan.push({ row, decision });
    const status =
      decision.action === "update" ? "CHANGE" : `SKIP (${decision.reason})`;
    const arrow =
      decision.action === "update"
        ? `${row.base_url} → ${decision.newUrl}`
        : row.base_url;
    console.log(
      "   " +
        padRight(row.tenant_slug, 14) +
        padRight(status, 26) +
        padRight(row.model_id, 22) +
        arrow,
    );
  }

  const changes = plan.filter((p) => p.decision.action === "update");
  console.log("");
  console.log(
    `→ Summary: ${changes.length} change(s), ${
      plan.length - changes.length
    } skip(s)`,
  );

  if (changes.length === 0) {
    console.log("");
    console.log("✅ Nothing to do — DB is already in sync with this env.");
    return;
  }

  if (!APPLY) {
    console.log("");
    console.log(
      "ℹ  Dry run — no writes performed. Re-run with `--apply` to commit:",
    );
    console.log("     pnpm ai:apply");
    return;
  }

  console.log("");
  console.log("→ Applying changes…");
  let ok = 0;
  let fail = 0;
  for (const { row, decision } of changes) {
    try {
      await applyUpdate(row, decision.newUrl);
      console.log(`   ✓ ${row.tenant_slug}`);
      ok++;
    } catch (err) {
      console.error(`   ✗ ${row.tenant_slug}: ${err.message}`);
      fail++;
    }
  }
  console.log("");
  console.log(`✅ Applied ${ok}/${changes.length} update(s)${fail ? `, ${fail} failed` : ""}.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
