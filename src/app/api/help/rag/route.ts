import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { retrieveContext } from "@/lib/help/retrieval";
import { log } from "@/lib/observability/log";
import { limit, RateLimitPresets } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/help/rag` — RAG-only fallback endpoint.
 *
 * Runs the same two-tier retrieval (`retrieveContext`) that
 * `/api/help/ask` uses internally, but skips the LLM call entirely
 * and returns the top-N articles as JSON. The client renders them as
 * "here are relevant docs" cards when the primary chat endpoint
 * fails — Groq daily-tokens-per-day cap, provider outage, empty
 * upstream response, etc.
 *
 * This is the "degraded but useful" mode described in the RAG
 * fallback strategy: even when NO LLM is reachable, users still get
 * curated docs anchored to the words they typed. Retrieval quality
 * is the same as normal chat (embeddings-first, fuse.js fallback) —
 * only the final synthesis step is missing.
 *
 * Guardrails:
 *   • Auth: reuses `requireCurrentEmployee` for the tenant context
 *     and to keep this endpoint out of anonymous-crawler reach.
 *   • Rate limit: shared with the chat endpoint (`helpChatPerUser` /
 *     `helpChatPerTenant`). If the user's already exhausted their
 *     per-minute chat budget, they don't get to bypass by hitting
 *     the fallback URL directly. In practice this is a soft cap —
 *     retrieval costs are negligible next to the LLM call, but
 *     keeping the same bucket avoids introducing a new abuse
 *     vector.
 *   • Body validation: same query length envelope (1..8000 chars)
 *     as `bodySchema.messages[].content` in `/api/help/ask`.
 *
 * Returns 200 with `{ articles: [{ slug, title, category, excerpt,
 * source, retrievalMode }] }`. An empty `articles` array is a valid
 * response — the client renders a "no results" state.
 */

const bodySchema = z.object({
  query: z.string().min(1).max(8000),
  limit: z.number().int().min(1).max(6).default(3).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const employee = await requireCurrentEmployee();
  const tenantId = employee.tenant_id;
  const userId = employee.user_id;

  // Reuse the chat rate-limit bucket. Retrieval is cheap, but a
  // separate bucket would let a caller double-dip (6 chat + 6 RAG
  // per minute) which is not the intent — RAG is a *fallback*, not
  // a parallel channel.
  const userLimit = await limit(
    `help-chat:user:${userId}`,
    RateLimitPresets.helpChatPerUser(),
  );
  if (!userLimit.allowed) {
    const retryAfter = Math.max(
      1,
      userLimit.resetAt - Math.floor(Date.now() / 1000),
    );
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        message: err instanceof Error ? err.message : "Invalid request body",
      },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  try {
    // Same includeTenant policy as `/api/help/ask` — the fallback
    // panel benefits equally from tenant KB hits, and skipping the
    // merge here would surface "no results" for tenants who put all
    // their content in the KB and none in the repo docs.
    const results = await retrieveContext(parsed.query, parsed.limit ?? 3, {
      includeTenant: true,
    });
    log.info("help_rag_fallback_hit", {
      tenant_id: tenantId,
      user_id: userId,
      query_chars: parsed.query.length,
      result_count: results.length,
      latency_ms: Date.now() - t0,
      retrieval_modes: results.map((r) => r.retrievalMode),
    });
    return NextResponse.json({ articles: results });
  } catch (err) {
    log.warn("help_rag_fallback_failed", {
      tenant_id: tenantId,
      user_id: userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: "retrieval_failed",
        message: "Knowledge base retrieval failed. Please try again.",
      },
      { status: 500 },
    );
  }
}
