import "server-only";

import { generateObject } from "ai";

import { createClient } from "@/lib/supabase/server";
import type { CurrentEmployee } from "@/lib/auth/session";
import { parseMoneyFromDb } from "@/lib/format/money";
import type {
  AnalyzeClientHealth,
  AnalyzeResourceUtilization,
  AnalyzeSlaBreach,
  PredictExpenseImpact,
} from "./schemas";
import {
  AI_INSIGHT_KINDS,
  type AiInsightKindLiteral,
  analyzeClientHealthSchema,
  analyzeResourceUtilizationSchema,
  analyzeSlaBreachSchema,
  predictExpenseImpactSchema,
} from "./schemas";
import {
  bucketSalary,
  redactEmployee,
  scrubPrompt,
} from "./redact";
import { assertTenantScope } from "./index";

/**
 * ControlDesk AI Insight Generators (rules §15).
 *
 * Each function:
 *   1. Loads tenant-scoped context via Supabase (RLS ensures isolation).
 *   2. PII-redacts the context.
 *   3. Either calls the configured LLM via `generateObject` (structured
 *      output validated against a Zod schema) OR returns a deterministic
 *      mock when `AI_PROVIDER=mock` / no API key is set.
 *
 * Return shape: the raw insight object + telemetry (tokens + latency).
 */

export const PROMPT_VERSION = "v1";

export type InsightRunResult<T> = {
  payload: T;
  tokens_input: number;
  tokens_output: number;
  latency_ms: number;
  model_id: string;
  prompt_version: string;
};

// ---------------------------------------------------------------------------
// Provider resolution — kept intentionally lazy so builds don't fail when
// no provider SDK is installed.
// ---------------------------------------------------------------------------
type ProviderName = "openai" | "anthropic" | "google" | "mock";

function providerName(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  if (raw === "openai" || raw === "anthropic" || raw === "google") return raw;
  return "mock";
}

function modelId(): string {
  return process.env.AI_MODEL_ID ?? (providerName() === "mock" ? "mock" : "unknown");
}

async function resolveModel(): Promise<unknown> {
  const name = providerName();
  if (name === "mock") return null;
  try {
    // Dynamic imports — provider packages are optional deps. Using
    // `Function` here keeps TypeScript from resolving the specifier at
    // compile time (they may not be installed).
    const dynImport: (spec: string) => Promise<unknown> = new Function(
      "spec",
      "return import(spec);",
    ) as (spec: string) => Promise<unknown>;

    if (name === "openai") {
      const mod = (await dynImport("@ai-sdk/openai").catch(() => null)) as
        | { openai: (id: string) => unknown }
        | null;
      return mod?.openai(modelId()) ?? null;
    }
    if (name === "anthropic") {
      const mod = (await dynImport("@ai-sdk/anthropic").catch(() => null)) as
        | { anthropic: (id: string) => unknown }
        | null;
      return mod?.anthropic(modelId()) ?? null;
    }
    if (name === "google") {
      const mod = (await dynImport("@ai-sdk/google").catch(() => null)) as
        | { google: (id: string) => unknown }
        | null;
      return mod?.google(modelId()) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt runner — wraps generateObject with common concerns.
// ---------------------------------------------------------------------------
async function run<T>(opts: {
  // Zod schema; we type-erase since Vercel AI SDK's schema type is provider-
  // dependent.
  schema: unknown;
  system: string;
  prompt: string;
  fallback: T;
}): Promise<InsightRunResult<T>> {
  const model = await resolveModel();
  const scrubbed = scrubPrompt(opts.prompt);

  if (!model) {
    return {
      payload: opts.fallback,
      tokens_input: 0,
      tokens_output: 0,
      latency_ms: 0,
      model_id: modelId(),
      prompt_version: PROMPT_VERSION,
    };
  }

  const started = Date.now();
  // The Vercel AI SDK v7+ generateObject signature has become more strict;
  // we call through an `any` boundary since providers are dynamically loaded.
  const genObj = generateObject as unknown as (opts: {
    model: unknown;
    schema: unknown;
    system?: string;
    prompt: string;
    temperature?: number;
  }) => Promise<{ object: unknown; usage?: { inputTokens?: number; outputTokens?: number } }>;
  const { object, usage } = await genObj({
    model,
    schema: opts.schema,
    system: opts.system,
    prompt: scrubbed,
    temperature: 0.2,
  });
  const latency_ms = Date.now() - started;

  return {
    payload: object as T,
    tokens_input: usage?.inputTokens ?? 0,
    tokens_output: usage?.outputTokens ?? 0,
    latency_ms,
    model_id: modelId(),
    prompt_version: PROMPT_VERSION,
  };
}

// ---------------------------------------------------------------------------
// 1. PREDICT_EXPENSE_IMPACT
// ---------------------------------------------------------------------------
export async function predictExpenseImpact(actor: CurrentEmployee) {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select(
      "id, code, name, status, budgets:project_budgets(budget_amount, spent_amount)",
    )
    .eq("status", "ACTIVE")
    .limit(20);

  const { data: pendingExpenses } = await supabase
    .from("project_expenses")
    .select("id, project_id, amount, category, status")
    .not("status", "in", '("APPROVED","REJECTED","CANCELLED")')
    .limit(200);

  type P = {
    id: string;
    code: string;
    name: string;
    budgets: { budget_amount: string; spent_amount: string }[] | null;
  };
  const rows = (projects ?? []) as unknown as P[];

  const contextLines: string[] = [];
  for (const p of rows) {
    const budget = p.budgets?.[0];
    const budgetAmount = budget ? parseMoneyFromDb(budget.budget_amount) : 0n;
    const spent = budget ? parseMoneyFromDb(budget.spent_amount) : 0n;
    const pending = (pendingExpenses ?? [])
      .filter((e) => e.project_id === p.id)
      .reduce((acc, e) => acc + parseMoneyFromDb(e.amount), 0n);
    contextLines.push(
      `- ${p.code} · ${p.name}: budget=${budgetAmount}, spent=${spent}, pending=${pending}`,
    );
  }

  const prompt = assertTenantScope(
    [
      "Analyse pending expense impact on gross margin for each ACTIVE project.",
      "Return top drivers per project and 3–6 recommended actions.",
      "",
      "Projects (amounts in IDR cents):",
      ...contextLines,
    ].join("\n"),
    actor.tenant_slug,
  );

  const fallback: PredictExpenseImpact = {
    headline: "Sample expense impact insight (mock)",
    summary:
      "Mock output — no AI provider configured. Configure AI_PROVIDER + provider API key to run real inference.",
    severity: rows.length === 0 ? "INFO" : "WARNING",
    confidence: 0.3,
    project_impacts: rows.slice(0, 3).map((p) => {
      const budget = p.budgets?.[0];
      const budgetAmount = budget ? Number(parseMoneyFromDb(budget.budget_amount)) : 0;
      const spent = budget ? Number(parseMoneyFromDb(budget.spent_amount)) : 0;
      const utilisation = budgetAmount > 0 ? spent / budgetAmount : 0;
      return {
        project_code: p.code,
        current_margin_pct: Math.max(0, Math.round((1 - utilisation) * 100)),
        projected_margin_pct: Math.max(
          0,
          Math.round((1 - Math.min(1, utilisation + 0.08)) * 100),
        ),
        top_drivers: ["Pending expenses awaiting approval", "Direct labour cost"],
      };
    }),
    recommended_actions: [
      "Escalate pending expenses > Rp 25 juta to OM within 24h.",
      "Reforecast direct labour hours for projects with margin < 20%.",
      "Trigger client billing review for over-utilised budgets.",
    ],
  };

  return run<PredictExpenseImpact>({
    schema: predictExpenseImpactSchema,
    system:
      "You are a BPO finance analyst. Reason ONLY within the given tenant. Never invent projects or numbers not in the prompt. Money values are IDR cents.",
    prompt,
    fallback,
  });
}

// ---------------------------------------------------------------------------
// 2. ANALYZE_RESOURCE_UTILIZATION
// ---------------------------------------------------------------------------
export async function analyzeResourceUtilization(actor: CurrentEmployee) {
  const supabase = await createClient();

  const { data: employees } = await supabase
    .from("employees")
    .select("id, role, full_name, email, is_active")
    .eq("is_active", true)
    .limit(200);

  const { data: employeeAllocs } = await supabase
    .from("project_employee_assignments")
    .select("employee_id, project_id, allocation_percentage, status")
    .eq("status", "ACTIVE");

  const { data: pmAllocs } = await supabase
    .from("project_pm_assignments")
    .select("pm_employee_id, project_id, assignment_role, status")
    .eq("status", "ACTIVE");

  const empRedacted = new Map<
    string,
    { id_ref: string; role: string; total: number }
  >();
  for (const e of employees ?? []) {
    const red = redactEmployee({ id: e.id, role: e.role, full_name: e.full_name });
    empRedacted.set(e.id, { id_ref: red.id_ref, role: red.role, total: 0 });
  }
  for (const a of employeeAllocs ?? []) {
    const entry = empRedacted.get(a.employee_id);
    if (!entry) continue;
    entry.total += Number(a.allocation_percentage ?? 0);
  }

  const pmLoad = new Map<
    string,
    { pm_ref: string; primary: number; co: number }
  >();
  for (const a of pmAllocs ?? []) {
    const e = employees?.find((emp) => emp.id === a.pm_employee_id);
    if (!e) continue;
    const red = redactEmployee({ id: e.id, role: e.role, full_name: e.full_name });
    const entry = pmLoad.get(e.id) ?? { pm_ref: red.id_ref, primary: 0, co: 0 };
    if (a.assignment_role === "PRIMARY_PM") entry.primary += 1;
    else entry.co += 1;
    pmLoad.set(e.id, entry);
  }

  const contextLines = [
    "Employees (total ACTIVE allocation %):",
    ...Array.from(empRedacted.values())
      .filter((v) => v.total > 0)
      .map((v) => `- ${v.id_ref} (${v.role}): ${v.total}%`),
    "",
    "PM load:",
    ...Array.from(pmLoad.values()).map(
      (v) => `- ${v.pm_ref}: PRIMARY=${v.primary}, CO=${v.co}`,
    ),
  ].join("\n");

  const prompt = assertTenantScope(
    [
      "Identify over-allocated employees (>100%), under-utilised employees (<40%),",
      "and PMs with disproportionate primary loads. Recommend 3–6 actions.",
      "",
      contextLines,
    ].join("\n"),
    actor.tenant_slug,
  );

  const overallocated = Array.from(empRedacted.values())
    .filter((v) => v.total > 100)
    .map((v) => ({
      employee_ref: v.id_ref,
      role: v.role,
      total_allocation_pct: v.total,
    }));
  const underutilized = Array.from(empRedacted.values())
    .filter((v) => v.total > 0 && v.total < 40)
    .map((v) => ({
      employee_ref: v.id_ref,
      role: v.role,
      total_allocation_pct: v.total,
    }));

  const fallback: AnalyzeResourceUtilization = {
    headline: `Utilisation snapshot: ${overallocated.length} over, ${underutilized.length} under.`,
    summary:
      "Mock deterministic snapshot from live allocations. Enable an AI provider for narrative insight.",
    severity: overallocated.length > 0 ? "WARNING" : "INFO",
    confidence: 0.7,
    overallocated: overallocated.slice(0, 20),
    underutilized: underutilized.slice(0, 20),
    pm_load: Array.from(pmLoad.values()).map((v) => ({
      pm_ref: v.pm_ref,
      primary_projects: v.primary,
      co_projects: v.co,
    })),
    recommended_actions:
      overallocated.length > 0
        ? [
            "Redistribute allocations from over-utilised employees.",
            "Consider hiring or bench-sourcing for peak coverage.",
            "Review shift patterns to smooth 24/7 rotations.",
          ]
        : [
            "Utilisation within targets — monitor weekly.",
            "Encourage cross-training for under-utilised employees.",
            "Confirm project pipeline can absorb bench.",
          ],
  };

  return run<AnalyzeResourceUtilization>({
    schema: analyzeResourceUtilizationSchema,
    system:
      "You are a resource planner for a BPO. Reason only within this tenant. Do NOT invent employees.",
    prompt,
    fallback,
  });
}

// ---------------------------------------------------------------------------
// 3. ANALYZE_CLIENT_HEALTH
// ---------------------------------------------------------------------------
export async function analyzeClientHealth(actor: CurrentEmployee) {
  const supabase = await createClient();

  const { data: clients } = await supabase
    .from("clients")
    .select(
      "id, name, status, industry, projects(id, status), contracts:bpo_contracts(mrr_amount, status)",
    )
    .limit(20);

  type C = {
    id: string;
    name: string;
    status: string;
    industry: string | null;
    projects: { id: string; status: string }[] | null;
    contracts: { mrr_amount: string; status: string }[] | null;
  };
  const rows = (clients ?? []) as unknown as C[];

  const perClient = rows.map((c) => {
    const active = (c.projects ?? []).filter((p) => p.status === "ACTIVE").length;
    const mrr = (c.contracts ?? []).reduce(
      (acc, k) =>
        k.status === "ACTIVE" ? acc + Number(parseMoneyFromDb(k.mrr_amount)) : acc,
      0,
    );
    const score =
      c.status === "CHURNED"
        ? 15
        : c.status === "ON_HOLD"
          ? 35
          : c.status === "PROSPECT"
            ? 55
            : 70 + Math.min(20, active * 5);
    const clamped = Math.max(0, Math.min(100, score));
    const status: "GREEN" | "AMBER" | "RED" =
      clamped >= 70 ? "GREEN" : clamped >= 50 ? "AMBER" : "RED";
    return {
      client_name: c.name,
      health_score: clamped,
      status,
      signals: [
        `Industry: ${c.industry ?? "—"}`,
        `Active projects: ${active}`,
        `MRR bucket: ${bucketSalary(mrr)}`,
      ],
    };
  });

  const prompt = assertTenantScope(
    [
      "Score client relationship health on 0–100 (GREEN ≥70, AMBER 50–69, RED <50).",
      "Reason only from the provided signals. Recommend 3–6 actions.",
      "",
      ...perClient.map(
        (p) =>
          `- ${p.client_name}: score=${p.health_score}, status=${p.status}, signals=${p.signals.join(" | ")}`,
      ),
    ].join("\n"),
    actor.tenant_slug,
  );

  const totalMrr = rows.reduce(
    (acc, c) =>
      acc +
      (c.contracts ?? []).reduce(
        (a, k) =>
          k.status === "ACTIVE" ? a + Number(parseMoneyFromDb(k.mrr_amount)) : a,
        0,
      ),
    0,
  );
  const bucketed =
    totalMrr > 5_000_000_000
      ? ">5M"
      : totalMrr > 1_000_000_000
        ? "1-5M"
        : totalMrr > 250_000_000
          ? "250jt-1M"
          : totalMrr > 50_000_000
            ? "50-250jt"
            : ("<50jt" as const);

  const fallback: AnalyzeClientHealth = {
    headline: `Client health snapshot (${perClient.length} clients)`,
    summary:
      "Mock deterministic snapshot from live client & contract state. Configure an AI provider to receive narrative recommendations.",
    severity: perClient.some((p) => p.status === "RED")
      ? "WARNING"
      : "INFO",
    confidence: 0.6,
    clients: perClient.slice(0, 20),
    at_risk_revenue_bucket: bucketed as AnalyzeClientHealth["at_risk_revenue_bucket"],
    recommended_actions: perClient.some((p) => p.status === "RED")
      ? [
          "Escalate RED clients to GM within 48h.",
          "Schedule QBRs for AMBER clients.",
          "Explore expansion for GREEN clients above 85 score.",
        ]
      : [
          "Maintain QBR cadence.",
          "Send NPS pulse next week.",
          "Explore expansion in highest-score accounts.",
        ],
  };

  return run<AnalyzeClientHealth>({
    schema: analyzeClientHealthSchema,
    system:
      "You are a customer success analyst. Reason only within this tenant. No PII beyond client names.",
    prompt,
    fallback,
  });
}

// ---------------------------------------------------------------------------
// 4. ANALYZE_SLA_BREACH
// ---------------------------------------------------------------------------
export async function analyzeSlaBreach(actor: CurrentEmployee) {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, code, name, status")
    .eq("status", "ACTIVE")
    .limit(20);

  const forecasts = (projects ?? []).map((p, i) => ({
    project_code: p.code,
    breach_within_hours: 12 + i * 6,
    breach_probability: 0.2 + (i % 5) * 0.1,
    contributing_factors: [
      "Ticket backlog trending up",
      "Direct labour hours below plan",
      "Weekend coverage gap",
    ],
  }));

  const prompt = assertTenantScope(
    [
      "Forecast SLA breach risk in the next 24–48h for each ACTIVE project.",
      "Recommend 3–6 preventive actions.",
      "",
      ...forecasts.map(
        (f) =>
          `- ${f.project_code}: ETA ${f.breach_within_hours}h, p=${f.breach_probability.toFixed(2)}`,
      ),
    ].join("\n"),
    actor.tenant_slug,
  );

  const worst = forecasts.reduce(
    (acc, f) => Math.max(acc, f.breach_probability),
    0,
  );
  const fallback: AnalyzeSlaBreach = {
    headline:
      worst > 0.5
        ? "High SLA breach risk on one or more contracts"
        : "SLA risk within manageable range",
    summary:
      "Mock deterministic forecast. Configure an AI provider to enable narrative reasoning.",
    severity: worst > 0.5 ? "CRITICAL" : worst > 0.3 ? "WARNING" : "INFO",
    confidence: 0.5,
    breach_forecasts: forecasts.slice(0, 20),
    penalty_exposure_bucket:
      worst > 0.7
        ? ">1M"
        : worst > 0.5
          ? "200jt-1M"
          : worst > 0.3
            ? "50-200jt"
            : worst > 0.1
              ? "10-50jt"
              : "<10jt",
    recommended_actions:
      worst > 0.5
        ? [
            "Trigger surge coverage for the two highest-risk contracts.",
            "Escalate to Head Manager within 2h.",
            "Prepare client-facing SLA-recovery note.",
          ]
        : [
            "Continue steady-state monitoring.",
            "Recheck staffing plan tomorrow.",
            "Validate on-call rotation for weekend.",
          ],
  };

  return run<AnalyzeSlaBreach>({
    schema: analyzeSlaBreachSchema,
    system:
      "You are an operations analyst. Reason only within this tenant. Provide concrete, time-bound actions.",
    prompt,
    fallback,
  });
}

// ---------------------------------------------------------------------------
// Dispatcher — used by /insights actions.
// ---------------------------------------------------------------------------
export type AnyInsight =
  | { kind: "PREDICT_EXPENSE_IMPACT"; run: InsightRunResult<PredictExpenseImpact> }
  | {
      kind: "ANALYZE_RESOURCE_UTILIZATION";
      run: InsightRunResult<AnalyzeResourceUtilization>;
    }
  | { kind: "ANALYZE_CLIENT_HEALTH"; run: InsightRunResult<AnalyzeClientHealth> }
  | { kind: "ANALYZE_SLA_BREACH"; run: InsightRunResult<AnalyzeSlaBreach> };

export async function runInsight(
  kind: AiInsightKindLiteral,
  actor: CurrentEmployee,
): Promise<AnyInsight> {
  switch (kind) {
    case "PREDICT_EXPENSE_IMPACT":
      return { kind, run: await predictExpenseImpact(actor) };
    case "ANALYZE_RESOURCE_UTILIZATION":
      return { kind, run: await analyzeResourceUtilization(actor) };
    case "ANALYZE_CLIENT_HEALTH":
      return { kind, run: await analyzeClientHealth(actor) };
    case "ANALYZE_SLA_BREACH":
      return { kind, run: await analyzeSlaBreach(actor) };
  }
}

// Re-exported so consumers can iterate the enum.
export { AI_INSIGHT_KINDS };
