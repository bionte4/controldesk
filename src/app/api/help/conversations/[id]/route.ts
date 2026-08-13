/**
 * `GET  /api/help/conversations/[id]` — hydrate messages for one thread.
 * `DELETE /api/help/conversations/[id]` — hard-delete a thread and all
 * its messages (cascades via FK).
 *
 * Isolation model matches the list endpoint:
 *   • `requireCurrentEmployee()` for auth.
 *   • RLS `tenant_chat_conversations_owner_write` + the messages
 *     table's own policy enforce `tenant_id = current_tenant_id() AND
 *     user_id = auth.uid()`. Guessing another user's uuid returns 0
 *     rows (indistinguishable from a genuine "not found" — no
 *     existence oracle).
 *
 * The GET handler filters out `tool` role rows on the way out. Tool
 * traces live in `tenant_chat_messages` for audit reproducibility,
 * but they're internal artefacts — the sidebar should render the
 * user-visible transcript only. When we later add a per-message
 * "show trace" toggle we'll opt-in from a query param.
 */
import { NextResponse } from "next/server";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConversationDetail = {
  id: string;
  title: string | null;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
  }>;
};

export async function GET(_req: Request, ctx: Params): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const employee = await requireCurrentEmployee();
  const supabase = await createClient();

  const { data: conv, error: convErr } = await supabase
    .from("tenant_chat_conversations")
    .select("id, title")
    .eq("id", id)
    .eq("tenant_id", employee.tenant_id)
    .eq("user_id", employee.user_id)
    .maybeSingle();

  if (convErr) {
    log.warn("help_conversations_get_failed", {
      tenant_id: employee.tenant_id,
      user_id: employee.user_id,
      conversation_id: id,
      error: convErr.message,
    });
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  if (!conv) {
    // 404 with no distinguishable body — same shape whether the row
    // never existed OR belonged to a different user. Prevents an
    // existence oracle across tenants.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: msgs, error: msgErr } = await supabase
    .from("tenant_chat_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", id)
    .eq("tenant_id", employee.tenant_id)
    .eq("user_id", employee.user_id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });

  if (msgErr) {
    log.warn("help_conversations_messages_failed", {
      tenant_id: employee.tenant_id,
      user_id: employee.user_id,
      conversation_id: id,
      error: msgErr.message,
    });
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const detail: ConversationDetail = {
    id: conv.id,
    title: conv.title,
    messages: (msgs ?? []).map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      created_at: m.created_at,
    })),
  };
  return NextResponse.json(detail);
}

export async function DELETE(_req: Request, ctx: Params): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const employee = await requireCurrentEmployee();
  const supabase = await createClient();

  // `on delete cascade` on `tenant_chat_messages.conversation_id`
  // removes messages automatically.
  const { error } = await supabase
    .from("tenant_chat_conversations")
    .delete()
    .eq("id", id)
    .eq("tenant_id", employee.tenant_id)
    .eq("user_id", employee.user_id);

  if (error) {
    log.warn("help_conversations_delete_failed", {
      tenant_id: employee.tenant_id,
      user_id: employee.user_id,
      conversation_id: id,
      error: error.message,
    });
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  log.info("help_conversation_deleted", {
    tenant_id: employee.tenant_id,
    user_id: employee.user_id,
    conversation_id: id,
  });
  return NextResponse.json({ ok: true });
}
