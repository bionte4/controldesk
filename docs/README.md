# ControlDesk documentation

Welcome. This index is the fastest way into the parts of the codebase
you need. Everything here is versioned in the repo so it stays in sync
with the code.

The **product + engineering source of truth** is [`.cursorrules`](../.cursorrules).
The docs in this tree are the "how" — how to run, extend, and operate
ControlDesk. `.cursorrules` is the "what" and "why".

## Onboarding

| Doc                                            | When to read it                                            |
| ---------------------------------------------- | ---------------------------------------------------------- |
| [`getting-started.md`](getting-started.md)     | First day. Boot the app, sign in, understand the seed.     |
| [`architecture.md`](architecture.md)           | Before making non-trivial changes.                         |
| [`security-model.md`](security-model.md)       | Before writing any Server Action.                          |
| [`development.md`](development.md)             | Every day. Feature folder + Server Action + i18n contract. |
| [`testing.md`](testing.md)                     | Before you push. Coverage gates + Playwright chain suites. |
| [`deployment.md`](deployment.md)               | Before you deploy. Docker / Vercel / Supabase prod flow.   |

## Reference

| Doc                                            | Purpose                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- |
| [`env-reference.md`](env-reference.md)         | Every `.env` variable, its default, and its owner.         |
| [`api-reference.md`](api-reference.md)         | Cron + observability + health endpoints (contract + auth). |

## Ops runbooks (`docs/ops/`)

These are on-call reading. Print them, tab them, follow them literally
during incidents. They map 1:1 to the rulebook sections that require an
operational surface.

| Runbook                                                 | Covers                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| [`ops/data-retention.md`](ops/data-retention.md)        | 10-year retention, cold archive layout, restore procedure.  |
| [`ops/observability.md`](ops/observability.md)          | Sentry / Axiom configuration, redaction, request IDs.       |
| [`ops/secret-rotation.md`](ops/secret-rotation.md)      | 90-day rotation calendar + automation cron.                 |

## Community + repo files

| File                                            | Purpose                                                   |
| ----------------------------------------------- | --------------------------------------------------------- |
| [`../README.md`](../README.md)                  | Top-level overview + first-run.                           |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md)      | How to open a PR that will get merged.                    |
| [`../SECURITY.md`](../SECURITY.md)              | Vulnerability disclosure policy + response SLAs.          |
| [`../CHANGELOG.md`](../CHANGELOG.md)            | Every user-visible change, mapped to `.cursorrules`.      |
| [`../.github/CODEOWNERS`](../.github/CODEOWNERS)| Review routing per surface.                               |
