-- 0085_tenant_chat_history.sql
--
-- Level 2 "Ask my data" chatbot (RFC 0001 — docs/rfc/0001-ask-my-data.md).
--
-- Persists conversations + messages for the /help?tab=ask chatbot so
-- the assistant can reference prior turns in a session. Also produces
-- an audit trail of every tool call the model asked to run, plus the
-- retrieved doc slugs used to ground the reply.
--
-- Retention: 90 days (see cleanup migration to follow; app-layer
-- purge OK for MVP).
--
-- Rollback:
--   drop policy if exists tenant_chat_conversations_tenant_read
--     on public.tenant_chat_conversations;
--   drop policy if exists tenant_chat_conversations_owner_write
--     on public.tenant_chat_conversations;
--   drop policy if exists tenant_chat_messages_tenant_read
--     on public.tenant_chat_messages;
--   drop policy if exists tenant_chat_messages_owner_write
--     on public.tenant_chat_messages;
--   drop trigger if exists set_chat_conversation_updated_at
--     on public.tenant_chat_conversations;
--   drop function if exists public.tg_chat_conversation_updated_at();
--   drop table if exists public.tenant_chat_messages;
--   drop table if exists public.tenant_chat_conversations;

-- ---------------------------------------------------------------
-- tenant_chat_conversations
-- ---------------------------------------------------------------
create table if not exists public.tenant_chat_conversations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  -- The conversation always belongs to a single user (the employee
  -- who owns it). Cross-user access is refused at the RLS layer —
  -- even a colleague in the same tenant can't read your chat.
  user_id        uuid not null references auth.users(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  -- Optional short title so the "recent conversations" browser (a
  -- follow-up UI, not in this migration) has something to render.
  -- Falls back to "New conversation" in the app layer when null.
  title          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists tenant_chat_conversations_tenant_user_idx
  on public.tenant_chat_conversations (tenant_id, user_id, updated_at desc);

alter table public.tenant_chat_conversations enable row level security;

-- SELECT — only the owner may read their own conversations. Note
-- that we DO NOT allow tenant admins to read other users' chats;
-- the chat contains free-text that could be sensitive, and audit
-- of tool calls is enough for compliance without exposing message
-- bodies.
create policy tenant_chat_conversations_tenant_read
  on public.tenant_chat_conversations
  for select
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

-- INSERT / UPDATE / DELETE — same scope. Server actions run under
-- the caller's session; the app never writes cross-user chat rows.
create policy tenant_chat_conversations_owner_write
  on public.tenant_chat_conversations
  for all
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  )
  with check (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

-- Keep updated_at in sync so the recent-conversations list can sort
-- deterministically.
create or replace function public.tg_chat_conversation_updated_at()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_chat_conversation_updated_at
  on public.tenant_chat_conversations;

create trigger set_chat_conversation_updated_at
  before update on public.tenant_chat_conversations
  for each row execute function public.tg_chat_conversation_updated_at();

-- ---------------------------------------------------------------
-- tenant_chat_messages
-- ---------------------------------------------------------------
create table if not exists public.tenant_chat_messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  conversation_id  uuid not null references public.tenant_chat_conversations(id) on delete cascade,
  -- Denormalised `user_id` so RLS can filter without a join. Trigger
  -- below keeps it consistent with the parent conversation.
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'tool')),
  -- `content` is plain text for user/assistant, and the JSON-encoded
  -- tool result string for 'tool' rows. We keep it text so a future
  -- migration can add markdown / rich content without splitting the
  -- column.
  content          text not null,
  -- Tool traces for assistant rows. Structure (jsonb):
  --   [
  --     { "name": "list_pending_approvals", "arguments": {}, "result_preview": "..." },
  --     ...
  --   ]
  -- Never store secrets here — args are model-supplied and the
  -- registry sanitises + typechecks them first.
  tool_calls       jsonb,
  -- Retrieval trace for assistant rows: [{ slug, mode, score? }, ...]
  retrieval        jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists tenant_chat_messages_conversation_idx
  on public.tenant_chat_messages (conversation_id, created_at asc);

create index if not exists tenant_chat_messages_tenant_user_created_idx
  on public.tenant_chat_messages (tenant_id, user_id, created_at desc);

alter table public.tenant_chat_messages enable row level security;

create policy tenant_chat_messages_tenant_read
  on public.tenant_chat_messages
  for select
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

create policy tenant_chat_messages_owner_write
  on public.tenant_chat_messages
  for all
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  )
  with check (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

comment on table public.tenant_chat_conversations is
  'Level 2 chatbot conversations. One row per user-initiated conversation. RLS: owner-only, tenant-scoped. Retention 90 days from updated_at (see RFC 0001).';

comment on table public.tenant_chat_messages is
  'Level 2 chatbot messages. `role` in (user, assistant, tool). Assistant rows carry tool_calls + retrieval jsonb for audit. RLS mirrors parent conversation.';
