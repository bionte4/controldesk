/**
 * `GET /api/help/conversations` — list the caller's own chat history.
 *
 * Returns the most recent conversations from `tenant_chat_conversations`
 * for the authenticated user, sorted by `updated_at desc`. Serves the
 * sidebar in `<HelpAskPanel />` so users can resume a past thread
 * instead of losing context on every reload.
 *
 * Isolation model:
 *
 *   • Auth: `requireCurrentEmployee()` — returns 401 on the caller's
 *     behalf if the session is missing.
 *   • RLS: `tenant_chat_conversations_tenant_read` (migration 0085)
 *     enforces `tenant_id = current_tenant_id() AND user_id = auth.uid()`.
 *     A colleague inside the same tenant CANNOT see this user's chats;
 *     titles can carry sensitive free-text so we're strict here.
 *   • Body: no free-form input — nothing user-supplied hits the DB.
 *
 * The message_count is derived server-side via a lightweight
 * head+count second query. We could join with a subselect, but PostgREST
 * doesn't have first-class `count(*)` in embed shapes without a view,
 * and the numbers here are small (≤ 10 conversations, capped bodies).
 */
import { NextResponse } from "next/server";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONVERSATIONS = 10;

export type ConversationSummary = {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
};

export async function GET(): Promise<Response> {
  const employee = await requireCurrentEmployee();
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("tenant_chat_conversations")
    .select("id, title, updated_at")
    .eq("tenant_id", employee.tenant_id)
    .eq("user_id", employee.user_id)
    .order("updated_at", { ascending: false })
    .limit(MAX_CONVERSATIONS);

  if (error) {
    log.warn("help_conversations_list_failed", {
      tenant_id: employee.tenant_id,
      user_id: employee.user_id,
      error: error.message,
    });
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  const ids = (rows ?? []).map((r) => r.id);
  const counts = await loadMessageCounts(supabase, employee.tenant_id, employee.user_id, ids);

  const conversations: ConversationSummary[] = (rows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    updated_at: r.updated_at,
    message_count: counts.get(r.id) ?? 0,
  }));

  return NextResponse.json({ conversations });
}

async function loadMessageCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  userId: string,
  conversationIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (conversationIds.length === 0) return map;

  // Pull only the visible-role rows (user + assistant); `tool` rows
  // are internal traces and shouldn't influence the "N messages"
  // badge shown to the user.
  const { data, error } = await supabase
    .from("tenant_chat_messages")
    .select("conversation_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .in("conversation_id", conversationIds)
    .in("role", ["user", "assistant"]);

  if (error || !data) return map;

  for (const row of data) {
    map.set(row.conversation_id, (map.get(row.conversation_id) ?? 0) + 1);
  }
  return map;
}
