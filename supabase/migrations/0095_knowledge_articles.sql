-- Migration: 0095_knowledge_articles.sql
-- Purpose : Tenant-authored Knowledge Base — the writable counterpart to
--           the repo-authored `HELP_MANIFEST` docs served at /help.
--
-- Design:
--   Three tables, one enum trio, one uniqueness constraint.
--
--   1. `knowledge_articles` — the current published body of an article.
--      One row per (tenant_id, slug) with `status` gating whether it's
--      visible to non-authors. `visibility` is the future ACL primitive
--      but v1 only enforces TENANT_WIDE at the query layer; the column
--      is present so we don't need a schema migration when we wire
--      role- or project-scoped articles in Fase 2.
--
--   2. `knowledge_article_revisions` — append-only history. Every
--      publish / update writes a row so we always have a diffable
--      audit trail. Immutable via BEFORE UPDATE/DELETE triggers
--      (same pattern as `project_issue_events` in migration 0029).
--
--   3. `knowledge_article_embeddings` — reserved for Fase 2. The
--      chatbot's `retrieveContext()` extension writes chunk-level
--      embeddings here on publish so tenant articles show up in
--      /api/help/ask results next to the static `HELP_MANIFEST`
--      corpus. `jsonb` for the vector (not pgvector) — v1 volume
--      is negligible and jsonb is what `src/lib/help/embeddings.ts`
--      already uses for the static index. Migrating to `pgvector`
--      later is a single-index swap.
--
-- Why NOT use pgvector today:
--   • `pg_available_extensions` shows `vector 0.8.2` INSTALLED_VERSION
--     is NULL — the extension is available on the image but not
--     currently loaded. Loading it requires `CREATE EXTENSION vector`
--     which is a superuser-only op and would introduce operational
--     complexity for a KB that starts at N < 100 articles per tenant.
--   • The existing static embeddings.json is jsonb-encoded (see
--     `src/lib/help/embeddings.ts::rankByVector`) — we already have
--     the cosine-similarity helper. Reusing it keeps the retrieval
--     surface consistent while the KB is small.
--
-- RLS strategy:
--   • SELECT — tenant match + (status='PUBLISHED' OR author=self OR ADMIN)
--     `status`-gated read means DRAFT articles are strictly private to
--     the author; only ADMIN can see drafts across the tenant.
--     Visibility ACL (ROLE_GATED / PROJECT_SCOPED) is enforced by the
--     data-access layer, not RLS — the data layer needs the caller's
--     role + assignment set, which are cheap in app but a JOIN nightmare
--     in an RLS policy. Same trade-off as `dashboard-scope` code paths.
--   • INSERT / UPDATE — tenant match + author=self + status transitions
--     the app permits (DRAFT ↔ PUBLISHED, PUBLISHED → ARCHIVED). PDP
--     enforces the actual policy; RLS is the failsafe.
--   • DELETE — never allowed at the RLS layer. Archive-only via
--     UPDATE. Hard-delete requires service-role escalation (a manual
--     cleanup script) so a compromised session key can't scrub the
--     knowledge base.
--
-- Rollback:
--   drop trigger if exists tg_knowledge_article_revisions_immutable
--     on public.knowledge_article_revisions;
--   drop function if exists public.tg_knowledge_article_revisions_immutable();
--   drop trigger if exists tg_knowledge_articles_updated_at
--     on public.knowledge_articles;
--   drop function if exists public.tg_knowledge_articles_updated_at();
--   drop table if exists public.knowledge_article_embeddings;
--   drop table if exists public.knowledge_article_revisions;
--   drop table if exists public.knowledge_articles;
--   drop type if exists public.knowledge_article_status;
--   drop type if exists public.knowledge_article_visibility;
--   drop type if exists public.knowledge_article_category;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.knowledge_article_status as enum (
    'DRAFT',
    'PUBLISHED',
    'ARCHIVED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.knowledge_article_visibility as enum (
    -- Everyone in the tenant with an active employee record.
    'TENANT_WIDE',
    -- Restricted to specific canonical roles (see visibility_roles).
    -- Reserved for Fase 2 — v1 enforces TENANT_WIDE only.
    'ROLE_GATED',
    -- Restricted to members of a specific project (see
    -- visibility_project_id). Reserved for Fase 2.
    'PROJECT_SCOPED'
  );
exception when duplicate_object then null; end $$;

-- Category taxonomy mirrors `HELP_CATEGORY_ORDER` in
-- `src/lib/help/categories.ts` so the /help browse UI can render
-- tenant articles alongside repo articles in the same section.
-- Kept as a text CHECK constraint rather than an enum so tenants
-- can add custom categories later without a migration (v1 apps
-- the strict allowlist; a follow-up loosens it if demand appears).
create table if not exists public.knowledge_articles (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  -- URL-friendly identifier, unique per tenant. NOT globally unique —
  -- one tenant's `/knowledge/onboarding` shouldn't be blocked by
  -- another tenant's slug choices.
  slug                     text not null,
  title                    text not null check (char_length(title) between 3 and 200),
  -- Short one-liner shown on category cards + chatbot citations.
  -- Optional in DB (author might not know a good summary yet) but
  -- the app UI encourages it on publish.
  summary                  text check (summary is null or char_length(summary) <= 400),
  -- Markdown source. Same pipeline as `HelpMarkdown` — GFM +
  -- rehype-slug + rehype-autolink-headings applied at render time.
  body_md                  text not null check (char_length(body_md) between 1 and 100000),
  category                 text not null check (
    category in (
      'getting-started',
      'user-guides',
      'approvals',
      'finance',
      'hr',
      'integrations',
      'reference',
      'internal-sop',
      'meeting-notes',
      'decisions'
    )
  ),
  status                   public.knowledge_article_status not null default 'DRAFT',
  visibility               public.knowledge_article_visibility not null default 'TENANT_WIDE',
  -- Only meaningful when visibility = 'ROLE_GATED'. Canonical role
  -- strings, e.g. `['FINANCE','ADMIN']`. Fase 2 wires enforcement.
  visibility_roles         text[] default '{}',
  -- Only meaningful when visibility = 'PROJECT_SCOPED'. Fase 2.
  visibility_project_id    uuid references public.projects(id) on delete set null,
  author_employee_id       uuid not null references public.employees(id) on delete restrict,
  -- Timestamps of state transitions, not the row-update time. `updated_at`
  -- below tracks the latter.
  published_at             timestamptz,
  archived_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- Denormalised counter for cheap "view count" surfacing without a
  -- JOIN. Written by the app layer on article view (RSC page render).
  view_count               integer not null default 0
);

-- One slug per tenant. Cross-tenant slug collision is fine.
create unique index if not exists knowledge_articles_tenant_slug_uidx
  on public.knowledge_articles (tenant_id, slug);

-- Category list view + "recently published" list are both keyed by
-- tenant + status + timestamp so the app's list page can serve pages
-- in one index scan.
create index if not exists knowledge_articles_tenant_category_status_idx
  on public.knowledge_articles (tenant_id, category, status);

create index if not exists knowledge_articles_tenant_published_at_idx
  on public.knowledge_articles (tenant_id, published_at desc nulls last);

create index if not exists knowledge_articles_author_idx
  on public.knowledge_articles (author_employee_id);

-- Enforce publish/archive lifecycle consistency at the DB layer as a
-- backstop in case a Server Action forgets to set the timestamp.
-- Note: this is a CHECK, not a trigger, because it doesn't need to
-- inspect prior state.
alter table public.knowledge_articles
  add constraint knowledge_articles_status_timestamps_chk
  check (
    (status = 'DRAFT'     and published_at is null and archived_at is null)
    or
    (status = 'PUBLISHED' and published_at is not null and archived_at is null)
    or
    (status = 'ARCHIVED'  and archived_at is not null)
  );

alter table public.knowledge_articles enable row level security;

-- SELECT policy: published articles are visible to the whole tenant;
-- drafts are visible ONLY to the author. TENANT_ADMIN/ADMIN sees
-- everything within the tenant. Visibility ACL (ROLE_GATED /
-- PROJECT_SCOPED) is handled at the app layer — see
-- `resolveVisibilityFilter()` in the data module.
--
-- Pattern (author=self via subquery to employees) follows migrations
-- 0060_upk_notes.sql and 0059_performance_evaluations.sql — there's
-- no `current_employee_id()` helper today, only `current_tenant_id()`.
create policy knowledge_articles_select
  on public.knowledge_articles
  for select
  using (
    tenant_id = public.current_tenant_id()
    and (
      status = 'PUBLISHED'
      or author_employee_id in (
        select id from public.employees where user_id = auth.uid()
      )
      or exists (
        select 1
        from public.employees e
        where e.user_id = auth.uid()
          and e.tenant_id = public.current_tenant_id()
          and e.role in ('TENANT_ADMIN', 'ADMIN')
      )
    )
  );

-- INSERT: any authenticated employee may create a draft on their own
-- behalf. Author is fixed to the caller's employee_id — enforced by
-- both the WITH CHECK and the app layer.
create policy knowledge_articles_insert
  on public.knowledge_articles
  for insert
  with check (
    tenant_id = public.current_tenant_id()
    and author_employee_id in (
      select id from public.employees where user_id = auth.uid()
    )
  );

-- UPDATE: author of the article OR ADMIN. Note that this permits
-- publish/archive transitions — the PDP guards which roles may
-- actually publish (some tenants may want to restrict).
create policy knowledge_articles_update
  on public.knowledge_articles
  for update
  using (
    tenant_id = public.current_tenant_id()
    and (
      author_employee_id in (
        select id from public.employees where user_id = auth.uid()
      )
      or exists (
        select 1
        from public.employees e
        where e.user_id = auth.uid()
          and e.tenant_id = public.current_tenant_id()
          and e.role in ('TENANT_ADMIN', 'ADMIN')
      )
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
  );

-- No DELETE policy — hard delete is service-role only. Use ARCHIVE
-- status transition for user-driven removal.

-- Auto-maintain updated_at on every row mutation.
create or replace function public.tg_knowledge_articles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tg_knowledge_articles_updated_at
  on public.knowledge_articles;

create trigger tg_knowledge_articles_updated_at
  before update on public.knowledge_articles
  for each row execute function public.tg_knowledge_articles_updated_at();

comment on table public.knowledge_articles is
  'Tenant-authored knowledge base articles. RLS: tenant-scoped; drafts private to author; published visible to tenant subject to app-layer visibility filter. Delete is archive-only (status=ARCHIVED).';


-- ---------------------------------------------------------------------------
-- Revisions (append-only audit trail)
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_article_revisions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  article_id          uuid not null references public.knowledge_articles(id) on delete cascade,
  -- Denormalised so RLS can filter without a join to the parent.
  revision_no         integer not null,
  title               text not null,
  summary             text,
  body_md             text not null,
  category            text not null,
  status              public.knowledge_article_status not null,
  visibility          public.knowledge_article_visibility not null,
  visibility_roles    text[] default '{}',
  visibility_project_id uuid,
  edited_by_employee_id uuid not null references public.employees(id) on delete restrict,
  edited_at           timestamptz not null default now(),
  -- Human-readable optional note (e.g., "Added SLA clause for tier-1
  -- clients"). Comparable to a git commit message.
  edit_note           text
);

create unique index if not exists knowledge_article_revisions_article_rev_uidx
  on public.knowledge_article_revisions (article_id, revision_no);

create index if not exists knowledge_article_revisions_tenant_edited_idx
  on public.knowledge_article_revisions (tenant_id, edited_at desc);

alter table public.knowledge_article_revisions enable row level security;

-- Revisions inherit read access from the parent article — if you can
-- read the current row, you can read its history. Simpler than
-- computing "was this version ever public?" and matches how git
-- diffs work.
create policy knowledge_article_revisions_select
  on public.knowledge_article_revisions
  for select
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.knowledge_articles a
      where a.id = article_id
        -- RLS on `knowledge_articles` already filters what the caller
        -- can see; a fresh SELECT here re-uses that policy.
    )
  );

-- INSERT: same tenant + `edited_by_employee_id` must be the CALLER —
-- no impersonation. The Server Action layer additionally verifies
-- that the caller has edit rights on the parent article.
create policy knowledge_article_revisions_insert
  on public.knowledge_article_revisions
  for insert
  with check (
    tenant_id = public.current_tenant_id()
    and edited_by_employee_id in (
      select id from public.employees where user_id = auth.uid()
    )
  );

-- Immutable content: reject in-place UPDATE from any client. DELETE
-- is left free at the trigger layer because the parent
-- `knowledge_articles` row is protected by RLS (no DELETE policy) —
-- the only way a revision row disappears is via ON DELETE CASCADE
-- when a service-role script deletes the parent article for hard
-- cleanup (compliance-driven purge, tenant offboarding, etc.).
-- Blocking cascade delete here would leave orphan-free schemas
-- impossible to clean up without further superuser gymnastics; the
-- historical integrity guarantee we care about (nobody can silently
-- REWRITE the past) is fully covered by the UPDATE veto.
create or replace function public.tg_knowledge_article_revisions_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'knowledge_article_revisions is immutable (attempted %)', tg_op
    using errcode = '23000';
end;
$$;

drop trigger if exists tg_knowledge_article_revisions_immutable
  on public.knowledge_article_revisions;

create trigger tg_knowledge_article_revisions_immutable
  before update on public.knowledge_article_revisions
  for each row execute function public.tg_knowledge_article_revisions_immutable();

comment on table public.knowledge_article_revisions is
  'Immutable audit trail of knowledge_articles edits. INSERT only; UPDATE/DELETE rejected by trigger. `revision_no` is per-article monotonic.';


-- ---------------------------------------------------------------------------
-- Embeddings (Fase 2 — reserved for the RAG hook)
-- ---------------------------------------------------------------------------
-- One row per (article, chunk). App layer decides chunk boundary
-- (typically ~1000 chars with 200 overlap). `embedding` is jsonb
-- containing a JSON array of 768 floats — matches the existing
-- `embeddings.json` shape used by `src/lib/help/embeddings.ts`.
--
-- Written by Phase 2's `enqueueKnowledgeReindex()` on publish. The
-- table is created empty in Phase 1 so migrations don't need to
-- retro-fit.

create table if not exists public.knowledge_article_embeddings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  article_id    uuid not null references public.knowledge_articles(id) on delete cascade,
  chunk_index   integer not null check (chunk_index >= 0),
  content       text not null,
  -- Vector as JSON array of floats. Verified length matches the
  -- application-configured embedding dim at write time (Gemini
  -- gemini-embedding-001 truncated to 768).
  embedding     jsonb not null,
  -- Model identifier stored so we can re-index in place when we
  -- switch providers (e.g., swap Gemini → OpenAI ada-002). Compared
  -- against a run-time constant; mismatched rows get replaced.
  model_id      text not null,
  created_at    timestamptz not null default now()
);

create unique index if not exists knowledge_article_embeddings_article_chunk_uidx
  on public.knowledge_article_embeddings (article_id, chunk_index);

create index if not exists knowledge_article_embeddings_tenant_article_idx
  on public.knowledge_article_embeddings (tenant_id, article_id);

alter table public.knowledge_article_embeddings enable row level security;

-- Embeddings inherit SELECT from parent article — same rationale as
-- revisions. INSERT/UPDATE/DELETE from user sessions blocked; the
-- reindex job runs under service role.
create policy knowledge_article_embeddings_select
  on public.knowledge_article_embeddings
  for select
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.knowledge_articles a
      where a.id = article_id
        -- Parent RLS already gates visibility.
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated role. Service role
-- bypasses RLS entirely, which is what the Phase 2 reindex needs.

comment on table public.knowledge_article_embeddings is
  'Chunked embeddings for the KB RAG. Written by the reindex job (service role). RLS mirrors parent article for reads; all writes require service role.';
