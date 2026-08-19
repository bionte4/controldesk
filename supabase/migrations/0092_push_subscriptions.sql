-- Migration: 0092_push_subscriptions.sql
-- Purpose : Persist Web Push (PWA) subscriptions per (tenant, user).
--
-- Context:
--   Day 2 of the Android APK roadmap. The Service Worker in `src/sw.ts`
--   already listens for `push` events (Day 1) — this migration is the
--   server-side counterpart that lets us send to those subscribers.
--
-- One row per browser install:
--   The Push API endpoint (`endpoint`) is issued by the push service
--   (FCM for Chrome/Android, APNs bridge for Safari, autopush for
--   Firefox) and is unique per browser instance. Reinstalling the PWA
--   / clearing site data / uninstalling the TWA all yield a NEW
--   endpoint, so one user can legitimately have several rows (one per
--   device). UNIQUE (tenant_id, endpoint) — the same endpoint should
--   never span tenants because scoping is per-origin, but we key on
--   both to keep the tenancy invariant explicit at the DB level.
--
-- Auto-cleanup:
--   When a browser revokes permission or a device is wiped, the push
--   service returns HTTP 404/410 on the next send. The dispatcher
--   (`src/lib/push/send.ts`) marks the row `disabled_at = now()` and
--   `disabled_reason` so we stop trying. A separate cron can archive
--   long-disabled rows if we care about table growth (unlikely at BPO
--   scale — even 1M rows fits comfortably).
--
-- Retention (rules §22):
--   No PII lives here beyond an opaque browser identifier. When an
--   employee leaves and the underlying `auth.users` row is deleted,
--   the FK cascade wipes their subscriptions automatically.
--
-- Rollback:
--   drop table public.push_subscriptions cascade;

begin;

-- -----------------------------------------------------------------------------
-- Extend `notification_channel` enum with `PUSH`.
--
-- The three existing side-channels (EMAIL / TELEGRAM / WHATSAPP) are
-- opt-in via `user_notification_preferences` per category. PUSH must
-- slot into the same switchboard so users get one unified control
-- surface — no separate "manage push" screen buried elsewhere.
--
-- `add value if not exists` is idempotent, but wraps in `do $$` since
-- `alter type ... add value` cannot run inside the parent transaction
-- when concurrent-safe mode is on — Postgres 12+ auto-commits it.
-- -----------------------------------------------------------------------------
alter type public.notification_channel add value if not exists 'PUSH';

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),

  -- Tenant discriminator (rules §5). Every table must carry it.
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Auth user that owns this browser subscription. `on delete cascade`
  -- so a purged user cleans up automatically.
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The Push API endpoint URL — opaque token issued by the push
  -- service. Length varies (FCM endpoints are ~250 chars, autopush
  -- is shorter). `text` handles any current or future format.
  endpoint text not null,

  -- Encryption keypair the browser hands us at subscribe time. Both
  -- are base64url-encoded byte strings; we send them back verbatim
  -- to `web-push` when dispatching.
  keys_p256dh text not null,
  keys_auth text not null,

  -- Best-effort UA capture for debugging ("why did chrome 132 stop
  -- receiving?"). Truncated at 512 to keep index size sane.
  user_agent text,

  -- Bookkeeping. `last_used_at` updated by the dispatcher on each
  -- successful send; helps identify dead subscriptions during
  -- retention sweeps.
  created_at timestamptz not null default now(),
  last_used_at timestamptz,

  -- Soft-disable when push service returns 404/410 (device gone).
  -- Keep the row a while so ops can debug delivery failures.
  disabled_at timestamptz,
  disabled_reason text,

  -- Same endpoint should never appear twice per tenant.
  constraint push_subscriptions_endpoint_uk unique (tenant_id, endpoint),

  -- Sanity: if disabled_reason is set, disabled_at must be too.
  constraint push_subscriptions_disabled_pair_ck check (
    (disabled_at is null and disabled_reason is null) or
    (disabled_at is not null)
  )
);

comment on table public.push_subscriptions is
  'One row per (tenant, user, browser) Web Push subscription. Dispatched via '
  '`src/lib/push/send.ts` when notifyUser() enqueues an in-app notification.';
comment on column public.push_subscriptions.endpoint is
  'Push service endpoint URL (FCM / APNs bridge / autopush). Opaque identifier.';
comment on column public.push_subscriptions.disabled_at is
  'Set by the dispatcher when the push service returns 404/410 (device unsubscribed).';

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
-- Dispatch-side lookup: "give me all active subs for user X in tenant Y".
-- Partial index skips disabled rows so hot path stays lean.
create index if not exists push_subscriptions_active_dispatch_idx
  on public.push_subscriptions (tenant_id, user_id)
  where disabled_at is null;

-- Cleanup-side lookup: "give me subs that have been disabled ≥ 30 days".
create index if not exists push_subscriptions_disabled_idx
  on public.push_subscriptions (disabled_at)
  where disabled_at is not null;

-- -----------------------------------------------------------------------------
-- RLS — user-scoped self-serve; service_role dispatches
-- -----------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

-- Users can only see their own subs, and only within their tenant JWT.
-- This lets the Preferences page show "3 devices currently subscribed".
create policy push_subscriptions_self_read
  on public.push_subscriptions
  for select
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

-- Users can subscribe their own device. Insert path from
-- `POST /api/push/subscribe`; tenant_id + user_id populated
-- server-side from the session — RLS enforces they can't
-- forge someone else's row.
create policy push_subscriptions_self_insert
  on public.push_subscriptions
  for insert
  with check (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

-- Update (upsert last_used_at, disable). User self-service unsubscribe
-- uses UPDATE (set disabled_at) rather than DELETE so we retain audit
-- history. Dispatcher (service_role) bypasses this.
create policy push_subscriptions_self_update
  on public.push_subscriptions
  for update
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  )
  with check (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

-- Hard delete only via user request ("forget this device"). Cascade
-- handles the auth.users deletion path.
create policy push_subscriptions_self_delete
  on public.push_subscriptions
  for delete
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

commit;
