import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { streamText } from "ai";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { commit, reserve } from "@/lib/ai/cost-cap";
import {
  COPILOT_SURFACES,
  copilotRequestSchema,
} from "@/lib/ai/copilot-surfaces";
import { resolveAiModel } from "@/lib/integrations/ai";
import { resolveRequestLocale } from "@/lib/i18n/request-locale";
import { log } from "@/lib/observability/log";
import { limit, RateLimitPresets } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/ai/copilot` — inline AI copilot for form fields (Level 3).
 *
 * The chatbot's smaller sibling: same auth / tenant / cost-cap /
 * rate-limit plumbing, but with a locked-down per-surface prompt and
 * no retrieval. Purpose is to refine short free-text fields on
 * transaction forms (cash advance purpose, expense description,
 * project description).
 *
 * ## Isolation model
 *
 *   • Tenant is pulled from the session — the request body cannot
 *     override it.
 *   • The `context` object is a client-supplied dictionary of form
 *     values the user already sees on-screen. Each surface has a
 *     whitelist of allowed keys (see COPILOT_SURFACES); anything
 *     outside that whitelist is silently dropped BEFORE reaching
 *     the prompt.
 *   • No DB reads from other tables. If it isn't in the form, the
 *     model doesn't see it. This keeps the copilot minimal and
 *     leak-proof by construction.
 *
 * ## Response
 *
 *   • Text stream, `text/plain; charset=utf-8`.
 *   • Consumers use `res.body.getReader()` — no @ai-sdk/react
 *     dependency on the client bundle.
 */
export async function POST(request: Request): Promise<Response> {
  const employee = await requireCurrentEmployee();
  const tenantId = employee.tenant_id;
  const userId = employee.user_id;

  // Rate limits BEFORE any expensive work.
  const userLimit = await limit(
    `ai-copilot:user:${userId}`,
    RateLimitPresets.aiCopilotPerUser(),
  );
  if (!userLimit.allowed) return tooManyRequests(userLimit.resetAt);
  const tenantLimit = await limit(
    `ai-copilot:tenant:${tenantId}`,
    RateLimitPresets.aiCopilotPerTenant(),
  );
  if (!tenantLimit.allowed) return tooManyRequests(tenantLimit.resetAt);

  // Parse + validate the body.
  let body: ReturnType<typeof copilotRequestSchema.parse>;
  try {
    body = copilotRequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        message: err instanceof Error ? err.message : "Invalid request body",
      },
      { status: 400 },
    );
  }

  const surface = COPILOT_SURFACES[body.surface];
  if (!surface) {
    // Schema already narrows this; defensive assertion for future safety.
    return NextResponse.json({ error: "unknown_surface" }, { status: 400 });
  }

  // Strip context keys that aren't whitelisted for this surface.
  const filteredContext: Record<string, string | number> = {};
  for (const key of surface.contextKeys) {
    if (Object.prototype.hasOwnProperty.call(body.context, key)) {
      filteredContext[key] = body.context[key]!;
    }
  }

  // Reserve tokens before hitting the LLM.
  const reservation = await reserve({
    tenantId,
    estimatedOutputTokens: surface.maxOutputTokens,
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
    await commit({ tenantId, delta: -surface.maxOutputTokens });
    return NextResponse.json(
      {
        error: "ai_not_configured",
        message:
          "AI is not configured for this workspace. Ask an admin to enable it in Settings → Integrations → AI.",
      },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenantRow || tenantRow.id !== tenantId) {
    await commit({ tenantId, delta: -surface.maxOutputTokens });
    return NextResponse.json(
      { error: "tenant_lookup_failed" },
      { status: 500 },
    );
  }

  const locale = resolveRequestLocale({
    cookies: await cookies(),
    acceptLanguage: request.headers.get("accept-language"),
  });
  const { system, user } = surface.buildPrompt({
    tenantName: tenantRow.name,
    locale,
    userInput: body.input,
    context: filteredContext,
  });

  const t0 = Date.now();
  try {
    const result = streamText({
      model: resolved.model as Parameters<typeof streamText>[0]["model"],
      system,
      messages: [{ role: "user", content: user }],
      // Slight creativity — refined output should sound natural, not
      // robotic. But still low enough that the copilot won't wander
      // off the input's intent.
      temperature: 0.4,
      maxOutputTokens: surface.maxOutputTokens,
      onFinish: async ({ usage }) => {
        const output = usage?.outputTokens ?? surface.maxOutputTokens;
        const delta = output - surface.maxOutputTokens;
        if (delta !== 0) await commit({ tenantId, delta });
        log.info("ai_copilot_reply", {
          tenant_id: tenantId,
          user_id: userId,
          surface: surface.id,
          model_id: resolved.modelId,
          input_tokens: usage?.inputTokens ?? null,
          output_tokens: output,
          latency_ms: Date.now() - t0,
          user_draft_chars: body.input.length,
          context_keys: Object.keys(filteredContext),
        });
      },
    });
    return result.toTextStreamResponse();
  } catch (err) {
    await commit({ tenantId, delta: -surface.maxOutputTokens });
    log.warn("ai_copilot_error", {
      tenant_id: tenantId,
      user_id: userId,
      surface: surface.id,
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

