import { NextResponse } from "next/server";
import { streamText, stepCountIs } from "ai";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { buildSystemPrompt } from "@/lib/help/chat-prompt";
import { retrieveContext } from "@/lib/help/retrieval";
import { resolveAiModel } from "@/lib/integrations/ai";
import { commit, reserve } from "@/lib/ai/cost-cap";
import { makeToolRegistry } from "@/lib/ai/tools";
import { toCanonicalRole } from "@/lib/rbac/roles";
import { log } from "@/lib/observability/log";
import { limit, RateLimitPresets } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/help/ask` — streaming chatbot endpoint (Level 2).
 *
 * ## Levels
 *
 *   • **Level 1** (docs-only RAG): stays the default when `useTools`
 *     is false OR the client omits `conversationId`. Pure static
 *     grounding — zero DB tool calls.
 *   • **Level 2** ("Ask my data"): unlocked when `useTools=true` AND
 *     `conversationId` is provided by the client. Adds:
 *       - Persistent history in `tenant_chat_messages` (RLS-scoped,
 *         see migration 0085).
 *       - A closed-world tool registry (`makeToolRegistry`) that
 *         gives the model 3 read-only tools. Each tool is scoped to
 *         the caller by injection — model-supplied arguments cannot
 *         override tenant / user / employee filters.
 *
 * The route always accepts Level 1 request shapes for backward
 * compatibility — omitting `conversationId` + `useTools` returns
 * exactly the same behaviour as before.
 *
 * See docs/rfc/0001-ask-my-data.md for the threat model that
 * motivates every guardrail below.
 */

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});
const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(20),
  /**
   * Client-owned conversation id. Optional — if omitted, we run
   * Level 1 (no history persistence, no tool access). The server
   * accepts any UUID the client sends and creates the row lazily on
   * first message; we do NOT let the client dictate the tenant_id
   * or user_id — those come from the session.
   */
  conversationId: z.string().uuid().optional(),
  /**
   * Explicit opt-in for Level 2. Even when a conversationId is
   * supplied, the client must acknowledge it wants tool access —
   * this keeps the "old client + new server" upgrade path safe.
   */
  useTools: z.boolean().optional(),
});

const ESTIMATED_OUTPUT_TOKENS = 400;
/**
 * Hard ceilings for the tool loop. `stopWhen: stepCountIs(N)` forbids
 * the model from chaining more than N steps (each step = one tool
 * call round-trip + response). Combined with per-turn token cap this
 * bounds cost per request even against a maximally chatty model.
 */
const MAX_STEPS = 4;

export async function POST(request: Request): Promise<Response> {
  const employee = await requireCurrentEmployee();
  const tenantId = employee.tenant_id;
  const userId = employee.user_id;
  const employeeId = employee.id;

  const userLimit = await limit(
    `help-chat:user:${userId}`,
    RateLimitPresets.helpChatPerUser(),
  );
  if (!userLimit.allowed) return tooManyRequests(userLimit.resetAt);
  const tenantLimit = await limit(
    `help-chat:tenant:${tenantId}`,
    RateLimitPresets.helpChatPerTenant(),
  );
  if (!tenantLimit.allowed) return tooManyRequests(tenantLimit.resetAt);

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
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
    return NextResponse.json({ error: "no_user_message" }, { status: 400 });
  }

  const useTools = payload.useTools === true && !!payload.conversationId;

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

  const supabase = await createClient();
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("id, name")
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

  // ------------------------------------------------------------------
  // Persistence: load or create conversation row + persist user turn.
  // ------------------------------------------------------------------
  let conversationId: string | null = null;
  if (payload.conversationId) {
    // Upsert conversation — creates on first message, no-ops after.
    // RLS enforces {tenant_id, user_id} scope; if a different user
    // somehow guessed a colleague's uuid, the upsert would fail with
    // an RLS error and we'd fall back to Level 1.
    const { data: convRow, error: convErr } = await supabase
      .from("tenant_chat_conversations")
      .upsert(
        {
          id: payload.conversationId,
          tenant_id: tenantId,
          user_id: userId,
          employee_id: employeeId,
        },
        { onConflict: "id" },
      )
      .select("id")
      .maybeSingle();
    if (convErr || !convRow) {
      // Continue as Level 1 rather than failing the whole request —
      // history is a nice-to-have.
      log.warn("help_chat_conversation_upsert_failed", {
        tenant_id: tenantId,
        user_id: userId,
        error: convErr?.message,
      });
    } else {
      conversationId = convRow.id;
      // Persist the user's new turn immediately so it's captured even
      // if the model call fails midway.
      await supabase.from("tenant_chat_messages").insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        user_id: userId,
        role: "user",
        content: lastUser.content,
      });
    }
  }

  const system = buildSystemPrompt({
    tenantName: tenantRow.name,
    locale,
    retrieved,
    toolsEnabled: useTools && !!conversationId,
  });

  // Build the tool registry only when Level 2 is actually enabled.
  // The AI SDK treats `undefined` tools same as no tools, so we're
  // safe to omit the property entirely in Level 1.
  const canonicalRole = toCanonicalRole(employee.role);
  const registry =
    useTools && conversationId
      ? makeToolRegistry({
          tenantId,
          employeeId,
          userId,
          canonicalRole,
          dbRole: employee.role,
          locale,
          supabase,
        })
      : null;

  const t0 = Date.now();
  try {
    const result = streamText({
      model: resolved.model as Parameters<typeof streamText>[0]["model"],
      system,
      messages: payload.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: 0.2,
      maxOutputTokens: ESTIMATED_OUTPUT_TOKENS,
      // Only pass tools when Level 2 is enabled. Level 1 requests stay
      // identical to the previous behaviour.
      ...(registry
        ? {
            tools: registry.tools,
            // stopWhen caps the tool-loop depth; the AI SDK stops
            // taking further steps once this returns true.
            stopWhen: stepCountIs(MAX_STEPS),
          }
        : {}),
      onFinish: async ({ usage, text }) => {
        const output = usage?.outputTokens ?? ESTIMATED_OUTPUT_TOKENS;
        const delta = output - ESTIMATED_OUTPUT_TOKENS;
        if (delta !== 0) await commit({ tenantId, delta });

        // Persist the assistant reply (and any tool traces) if we
        // have a conversation to attach them to.
        if (conversationId) {
          try {
            // Cast trace + retrieval arrays through JSON — they're
            // plain-object shaped so the round-trip through Supabase's
            // `Json` type is lossless, but the compiler needs a hint.
            const toolCallsJson = registry
              ? (JSON.parse(JSON.stringify(registry.traces)) as unknown)
              : null;
            const retrievalJson = JSON.parse(
              JSON.stringify(
                retrieved.map((r) => ({
                  slug: r.slug,
                  mode: r.retrievalMode,
                })),
              ),
            ) as unknown;
            await supabase.from("tenant_chat_messages").insert({
              tenant_id: tenantId,
              conversation_id: conversationId,
              user_id: userId,
              role: "assistant",
              content: text ?? "",
              tool_calls: toolCallsJson as never,
              retrieval: retrievalJson as never,
            });
            await supabase
              .from("tenant_chat_conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", conversationId);
          } catch (err) {
            log.warn("help_chat_persist_reply_failed", {
              tenant_id: tenantId,
              conversation_id: conversationId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        log.info("help_chat_reply", {
          tenant_id: tenantId,
          user_id: userId,
          conversation_id: conversationId,
          level: registry ? 2 : 1,
          model_id: resolved.modelId,
          input_tokens: usage?.inputTokens ?? null,
          output_tokens: output,
          latency_ms: Date.now() - t0,
          retrieved: retrieved.map((r) => ({
            slug: r.slug,
            mode: r.retrievalMode,
          })),
          tool_calls: registry
            ? registry.traces.map((t) => ({
                name: t.name,
                ok: t.ok,
                duration_ms: t.duration_ms,
              }))
            : [],
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

function detectLocale(header: string | null): "id" | "en" {
  if (!header) return "id";
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("en")) return "en";
  return "id";
}
