import { NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { buildSystemPrompt } from "@/lib/help/chat-prompt";
import { retrieveContext } from "@/lib/help/retrieval";
import { resolveAiModel } from "@/lib/integrations/ai";
import { commit, reserve } from "@/lib/ai/cost-cap";
import { log } from "@/lib/observability/log";
import { limit, RateLimitPresets } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
// The route streams tokens; caching is nonsensical and would break the
// SSE headers Next.js writes.
export const dynamic = "force-dynamic";

/**
 * `POST /api/help/ask` — streaming endpoint for the "Ask ControlDesk"
 * chatbot on `/help`.
 *
 * Contract:
 *   • Body: `{ messages: [{ role: 'user' | 'assistant', content: string }, ...] }`.
 *   • Auth: requires an authenticated employee (rules §17). The route
 *     inherits tenant isolation from `requireCurrentEmployee()` —
 *     tenant_slug and tenant_id are pulled from the session's employee
 *     row, never from the request body.
 *   • Rate limit: per-user + per-tenant (RateLimitPresets.helpChatPerUser
 *     / helpChatPerTenant). Exceeding either returns 429 with a
 *     `Retry-After` header.
 *   • Token cap: `reserve()` against the tenant's daily AI budget
 *     BEFORE invoking the LLM. Overshoot returns 402 (Payment
 *     Required-ish; keeps the failure semantics distinct from 429).
 *   • Response: plain text stream. Content-Type: `text/plain;
 *     charset=utf-8`. Consumers use `res.body.getReader()`.
 *
 * ## Not in this route (deliberately)
 *
 *   • No tool calling — Level 1 is docs-only. When we add "Ask my
 *     data" (Level 2, per the roadmap), tool call handling wires in
 *     here with a whitelist + per-call PDP.
 *   • No history persistence — history is ephemeral per user's Fase-2
 *     choice. The client is the source of truth for the message list.
 *     If we later add DB history, it lands in `tenant_chat_messages`
 *     tagged by tenant_id and RLS-guarded.
 *   • No `ai_insights` write — that table is for the 4 structured
 *     generators (predict-expense, analyze-resource, analyze-client,
 *     analyze-sla). Chat responses are freeform and don't fit that
 *     schema; we log a compact telemetry event via `log.info` instead.
 */

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});
const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(20),
});

const ESTIMATED_OUTPUT_TOKENS = 400;

export async function POST(request: Request): Promise<Response> {
  const employee = await requireCurrentEmployee();
  const tenantId = employee.tenant_id;
  const userId = employee.user_id;

  // Per-user + per-tenant rate limits are cheap Redis operations; do
  // them BEFORE any DB / LLM work so a locked-out user pays no cost.
  const userLimit = await limit(
    `help-chat:user:${userId}`,
    RateLimitPresets.helpChatPerUser(),
  );
  if (!userLimit.allowed) {
    return tooManyRequests(userLimit.resetAt);
  }
  const tenantLimit = await limit(
    `help-chat:tenant:${tenantId}`,
    RateLimitPresets.helpChatPerTenant(),
  );
  if (!tenantLimit.allowed) {
    return tooManyRequests(tenantLimit.resetAt);
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    payload = bodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        message: err instanceof Error ? err.message : "Invalid request body",
      },
      { status: 400 },
    );
  }

  const lastUser = [...payload.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUser) {
    return NextResponse.json(
      { error: "no_user_message" },
      { status: 400 },
    );
  }

  // Reserve tokens BEFORE contacting the provider. If the tenant is
  // out of budget the model call never runs.
  const reservation = await reserve({
    tenantId,
    estimatedOutputTokens: ESTIMATED_OUTPUT_TOKENS,
  });
  if (!reservation.ok) {
    return NextResponse.json(
      {
        error: "daily_ai_budget_exceeded",
        used: reservation.used,
        cap: reservation.cap,
        wouldExceedBy: reservation.wouldExceedBy,
      },
      { status: 402 },
    );
  }

  const resolved = await resolveAiModel(tenantId);
  if (!resolved) {
    // Roll back the reservation — we didn't actually spend anything.
    await commit({ tenantId, delta: -ESTIMATED_OUTPUT_TOKENS });
    return NextResponse.json(
      {
        error: "ai_not_configured",
        message:
          "AI is not configured for this workspace. Ask an admin to enable it in Settings → Integrations → AI.",
      },
      { status: 503 },
    );
  }

  // Look up the tenant display name for the system prompt. Use the
  // session-scoped client — the caller already belongs to this tenant
  // by construction, and RLS on `tenants` grants SELECT to members.
  const supabase = await createClient();
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenantRow || tenantRow.id !== tenantId) {
    await commit({ tenantId, delta: -ESTIMATED_OUTPUT_TOKENS });
    return NextResponse.json(
      { error: "tenant_lookup_failed" },
      { status: 500 },
    );
  }

  const locale = detectLocale(request.headers.get("accept-language"));
  const retrieved = await retrieveContext(lastUser.content, 3);
  const system = buildSystemPrompt({
    tenantName: tenantRow.name,
    locale,
    retrieved,
  });

  const t0 = Date.now();
  try {
    // `messages` from the client is [{role, content}]. `streamText`
    // accepts this shape directly; we prepend the system prompt.
    const result = streamText({
      model: resolved.model as Parameters<typeof streamText>[0]["model"],
      system,
      messages: payload.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      // Low temperature keeps the answer close to the CONTEXT above.
      // Level 1 wants correctness > creativity.
      temperature: 0.2,
      // Cap output so a runaway response can't nuke the daily budget.
      // The reservation was for ESTIMATED_OUTPUT_TOKENS; we set the
      // model ceiling to the same value.
      maxOutputTokens: ESTIMATED_OUTPUT_TOKENS,
      onFinish: async ({ usage }) => {
        // Commit the delta between the reservation and actual usage.
        // Positive delta charges the tenant more; negative refunds.
        const output = usage?.outputTokens ?? ESTIMATED_OUTPUT_TOKENS;
        const delta = output - ESTIMATED_OUTPUT_TOKENS;
        if (delta !== 0) await commit({ tenantId, delta });
        log.info("help_chat_reply", {
          tenant_id: tenantId,
          user_id: userId,
          model_id: resolved.modelId,
          input_tokens: usage?.inputTokens ?? null,
          output_tokens: output,
          latency_ms: Date.now() - t0,
          retrieved: retrieved.map((r) => r.slug),
        });
      },
    });
    return result.toTextStreamResponse();
  } catch (err) {
    await commit({ tenantId, delta: -ESTIMATED_OUTPUT_TOKENS });
    log.warn("help_chat_error", {
      tenant_id: tenantId,
      user_id: userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "llm_failed" }, { status: 502 });
  }
}

function tooManyRequests(resetAt: number): Response {
  const retryAfter = Math.max(1, resetAt - Math.floor(Date.now() / 1000));
  return NextResponse.json(
    { error: "rate_limited", retryAfter },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    },
  );
}

/**
 * Pick "id" or "en" from the browser's Accept-Language. Defaults to
 * "id" because the docs are Indonesian-first. Small helper — not
 * worth pulling in a full negotiation library for two locales.
 */
function detectLocale(header: string | null): "id" | "en" {
  if (!header) return "id";
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("en")) return "en";
  return "id";
}
