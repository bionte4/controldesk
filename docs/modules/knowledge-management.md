# Knowledge Management

Tenant-authored knowledge base — the writable counterpart to the
repo-authored `/help` docs. Every employee can capture and share
SOPs, meeting notes, and internal decisions inside the workspace,
and the same corpus feeds the AI chatbot's retrieval augmentation
in Fase 2.

Route: `/knowledge` (list) + `/knowledge/{slug}` (article) +
`/knowledge/new` and `/knowledge/{slug}/edit` (author).

## Why we built this

The static `/help` route (see `docs/modules/ai-and-notifications.md`
§Help Chatbot) covers _product_ documentation. But every tenant
also accumulates _operational_ knowledge that shouldn't be
committed to the ControlDesk source tree:

- SOPs for internal processes ("How we onboard a new client")
- Decision records ("Why we switched from Groq to Ollama in Q3")
- Meeting minutes worth preserving
- Runbooks for one-off systems

Before Fase 1 this content lived in Slack, Notion, or nowhere.
This module gives it a first-class home with:

- **RLS-enforced tenant isolation** — no data leaves the tenant.
- **Draft-until-published lifecycle** — authors can save work in
  progress without exposing half-baked content.
- **Immutable revision history** — every edit becomes an audit row.
- **Same markdown pipeline as `/help`** — no context switch for
  readers.

## Data model (migration 0095)

Three tables, all tenant-scoped:

### `knowledge_articles`

The current published body of an article. One row per
`(tenant_id, slug)`.

| Column                  | Type                          | Notes                                                                              |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `id`                    | uuid                          | Primary key.                                                                       |
| `tenant_id`             | uuid                          | FK `tenants(id)`, cascade-deleted with the tenant.                                 |
| `slug`                  | text                          | URL segment. Unique per tenant. 3–80 chars, `[a-z0-9-]`.                           |
| `title`                 | text                          | 3–200 chars.                                                                       |
| `summary`               | text (nullable)               | ≤ 400 chars. Required to publish, optional for drafts.                             |
| `body_md`               | text                          | Markdown source. 1–100 000 chars. Rendered client-side via `HelpMarkdown`.         |
| `category`              | text (CHECK)                  | See taxonomy below.                                                                |
| `status`                | `knowledge_article_status`    | `DRAFT`, `PUBLISHED`, or `ARCHIVED`.                                               |
| `visibility`            | `knowledge_article_visibility`| v1 accepts only `TENANT_WIDE`; `ROLE_GATED` / `PROJECT_SCOPED` reserved for Fase 2.|
| `visibility_roles`      | text[]                        | Fase 2 — ignored in v1.                                                            |
| `visibility_project_id` | uuid                          | Fase 2 — ignored in v1.                                                            |
| `author_employee_id`    | uuid                          | FK `employees(id)`. Cannot be null.                                                |
| `published_at`          | timestamptz                   | Set on `PUBLISHED`, null otherwise.                                                |
| `archived_at`           | timestamptz                   | Set on `ARCHIVED`, null otherwise.                                                 |
| `view_count`            | integer                       | Bumped on published-article view. Best-effort.                                     |
| `created_at`            | timestamptz                   |                                                                                    |
| `updated_at`            | timestamptz                   | Maintained by `tg_knowledge_articles_updated_at`.                                  |

A CHECK constraint enforces `status` ↔ timestamp consistency
(`PUBLISHED` requires `published_at`, `ARCHIVED` requires
`archived_at`, `DRAFT` requires both null). Server Actions manage
these transitions atomically.

### `knowledge_article_revisions`

Append-only history. One row per edit / lifecycle transition.

The `tg_knowledge_article_revisions_immutable` trigger rejects
`UPDATE` from any client — DELETE is permitted so `ON DELETE
CASCADE` from the parent article works when a service-role script
purges data (compliance-driven).

| Column                | Type    | Notes                                    |
| --------------------- | ------- | ---------------------------------------- |
| `id`                  | uuid    | Primary key.                             |
| `tenant_id`           | uuid    | Denormalised for RLS.                    |
| `article_id`          | uuid    | FK `knowledge_articles(id)`.             |
| `revision_no`         | integer | Per-article monotonic. Unique per article.|
| `title`               | text    | Snapshot at edit time.                   |
| `summary`             | text    | Snapshot.                                |
| `body_md`             | text    | Snapshot.                                |
| `category`            | text    | Snapshot.                                |
| `status`              | enum    | Snapshot.                                |
| `visibility`          | enum    | Snapshot.                                |
| `edited_by_employee_id`| uuid   | Actor.                                   |
| `edited_at`           | timestamptz |                                     |
| `edit_note`           | text (nullable) | Optional git-commit-style note.  |

### `knowledge_article_embeddings`

Reserved for Fase 2. Chunk-level embeddings written by the RAG
reindex job (service role only). `embedding` is stored as `jsonb`
matching the shape used by the static `HELP_MANIFEST` corpus in
`src/lib/help/embeddings.ts`; migrating to `pgvector` later is a
single-index swap when volumes justify it.

### Category taxonomy

Ten categories, the first seven mirroring `HELP_CATEGORY_ORDER`
(`src/lib/help/categories.ts`) so the /help browse UI can render
tenant articles under the same headings:

- `getting-started`
- `user-guides`
- `approvals`
- `finance`
- `hr`
- `integrations`
- `reference`

Plus three KB-only categories that never surface in the public
`/help` route:

- `internal-sop`
- `meeting-notes`
- `decisions`

The list is enforced by a `CHECK` constraint on
`knowledge_articles.category` — extending it requires a follow-up
migration.

## RLS policies

Every table has RLS enabled. Policy names are prefixed with the
table name (`knowledge_articles_select`,
`knowledge_articles_insert`, etc.).

### `knowledge_articles`

- **SELECT** — allowed when `tenant_id = current_tenant_id()` AND
  (`status = 'PUBLISHED'` OR caller is the author OR caller is
  `TENANT_ADMIN`/`ADMIN`).
- **INSERT** — tenant match AND `author_employee_id` = caller's
  employee id.
- **UPDATE** — tenant match AND caller is author OR admin.
- **DELETE** — NOT allowed by any policy. Archiving is the
  user-visible removal; hard delete requires service-role
  escalation.

Visibility ACL (`ROLE_GATED` / `PROJECT_SCOPED`) is enforced at
the app layer, not RLS, because it requires joining against the
caller's active assignment set. Fase 2 will build a
`resolveVisibilityFilter()` helper in the data module.

### `knowledge_article_revisions`

- **SELECT** — inherits from the parent article's visibility.
- **INSERT** — tenant match AND `edited_by_employee_id` = caller.
- **UPDATE / DELETE** — see the immutability trigger above.

### `knowledge_article_embeddings`

- **SELECT** — inherits from the parent article.
- **INSERT / UPDATE / DELETE** — no user-role policy. Service role
  (which bypasses RLS) is the only writer. This is the standard
  pattern for background-job-owned tables.

## PDP contract

Verb → policy mapping in `decideKnowledgeArticle()`
(`src/lib/security/pdp.ts`):

| Verb     | Who can act                                    | Notes                                                     |
| -------- | ---------------------------------------------- | --------------------------------------------------------- |
| `read`   | Everyone in tenant                             | RLS handles draft filtering.                              |
| `create` | Any employee                                   | Contribution is intentionally frictionless.               |
| `update` | Author OR admin (TENANT_ADMIN/ADMIN/HR_ADMIN)  | Requires `ownerEmployeeId` in attributes.                 |
| `submit` | Author OR admin (used as **publish**)          | Verb reused because `AuditActionType` has no `PUBLISH`.   |
| `cancel` | Author OR admin (used as **archive**)          | Verb reused because `AuditActionType` has no `ARCHIVE`.   |
| `delete` | Never (all attempts DENY)                      | Hard delete is service-role only.                         |

Why verb reuse instead of new enum values? The
`audit_action_type` DB enum was defined in migration `0009`
before KB existed. Adding `PUBLISH` / `ARCHIVE` would be a
one-line migration but doesn't add semantic value — the audit row
already carries `auditNewValues.transition = "PUBLISH"` (or
`"ARCHIVE"` / `"RESTORE"`) so downstream analytics can filter
without a schema change.

## Server Actions

All in `src/app/(app)/knowledge/actions.ts`, all wrapped with
`withSecureAction`:

| Action                              | Zod schema                          | PDP verb | Notes                                    |
| ----------------------------------- | ----------------------------------- | -------- | ---------------------------------------- |
| `createKnowledgeArticleAction`      | `createKnowledgeArticleSchema`      | `create` | Always creates a DRAFT + revision #1.    |
| `updateKnowledgeArticleAction`      | `updateKnowledgeArticleSchema`      | `update` | Any subset of fields; appends revision.  |
| `publishKnowledgeArticleAction`     | `publishKnowledgeArticleSchema`     | `submit` | Requires ≥ 10 char summary.              |
| `archiveKnowledgeArticleAction`     | `archiveKnowledgeArticleSchema`     | `cancel` |                                          |
| `restoreKnowledgeArticleAction`     | `restoreKnowledgeArticleSchema`     | `update` | ARCHIVED → DRAFT to enable editing.      |

Every mutation:

1. Loads the current row via `loadKnowledgeArticleById()` to
   surface `ownerEmployeeId` to the PDP.
2. Mutates the parent row.
3. Appends a revision row via `appendKnowledgeArticleRevision()`.
   Revision failure is logged but doesn't roll back the mutation
   (revisions are diagnostic, not correctness — same trade-off as
   the audit log's "log-after-mutation" pattern).
4. `revalidatePath("/knowledge")` + `revalidatePath("/knowledge/{slug}")`.
5. Wrapper records an `AUDIT_ACTION_TYPE` row.

## UI surface

- **List** (`/knowledge`) — RSC. Header + "Write article" CTA,
  stats strip, "Your drafts" section (only rows authored by
  caller), then published articles grouped by category. Empty
  state hint when the tenant hasn't published anything yet.
- **View** (`/knowledge/{slug}`) — RSC with a Fase 1
  actions bar (client component) for authors / admins. Draft and
  archived states surface as coloured badges. `HelpMarkdown`
  handles the prose rendering.
- **New** (`/knowledge/new`) — client form via
  `KnowledgeArticleForm`. Auto-derives slug from title until the
  author touches the slug field. Preview toggle switches to
  markdown-rendered view side by side.
- **Edit** (`/knowledge/{slug}/edit`) — same form component
  seeded with the current article body. Refuses to edit
  ARCHIVED articles until they're restored to DRAFT (both PDP
  and UI enforce).

All i18n keys live under `knowledge.*` in `messages/{id,en}.json`.

## Nav placement

Under **Utilities**, right after **Help**. Pinned, universal for
every authenticated user (see `src/lib/nav/config.ts`). Every
employee can both read and author, so no role gate is applied.

## Smoke test

`pnpm knowledge:smoke` runs `scripts/knowledge-smoke.mjs` — a
Playwright walk of the full lifecycle:

1. Login as tenant admin.
2. Open `/knowledge`.
3. Click "Write article" → fill form → save draft.
4. Verify DRAFT badge on the article page.
5. Publish → confirm summary → verify badge cleared.
6. Archive → verify badge.
7. Restore → verify badge back.

The script cleans up after itself only when its assertions all
pass — see the `revisions is immutable` behaviour, which means a
mid-run failure leaves an artifact in the DB that a follow-up
`DELETE FROM knowledge_articles WHERE slug LIKE 'kb-smoke-%'`
will cascade-clean via the tenant-scoped `ON DELETE CASCADE`.

## Fase 2 roadmap

Documented as pending todos on this feature. Concretely:

1. **RAG integration** — extend `retrieveContext()`
   (`src/lib/help/retrieval.ts`) to also query
   `knowledge_article_embeddings`. Auto-embed on publish via a
   new `enqueueKnowledgeReindex()` job. Chatbot citations link
   into `/knowledge/{slug}` alongside the existing
   `HELP_MANIFEST` slots.
2. **Global search** — teach `HelpSearch`
   (`src/components/help/help-search.tsx`) to accept an
   optional `tenantArticles` prop, so `Ctrl+K` finds tenant
   articles too.
3. **Visibility ACL** — implement `resolveVisibilityFilter()`
   at the data-layer, enabling `ROLE_GATED` and
   `PROJECT_SCOPED` writes.
4. **Redirect map** — reuse
   `knowledge_article_revisions.title/slug` snapshots to build
   a slug-alias table so renamed articles keep their old URLs.
5. **Moderation queue** — optional per-tenant setting to
   require admin approval before `DRAFT → PUBLISHED`. Adds a
   `PUBLISH_REQUEST` status between draft and published.
