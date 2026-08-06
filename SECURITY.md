# Security Policy

ControlDesk stores tenant-scoped financial + HRIS data with a 10-year
retention window (rules §22). We take vulnerabilities seriously.

## Reporting a vulnerability

**Do NOT open a public GitHub issue.** Use one of the private channels
below:

1. **Preferred** — [Open a private security advisory](../../security/advisories/new)
   directly on this repository. GitHub notifies only the maintainers.
2. **Alternative** — Email `security@controldesk.app` (PGP fingerprint
   `TODO: add before public release`). Include the string `[SEC]` in
   the subject line so the address alias auto-routes to on-call.

Please include:

- A minimum reproducible example (curl / Playwright / SQL).
- Impact assessment: cross-tenant leak? auth bypass? PII exposure?
  privilege escalation? data-at-rest exposure?
- The commit SHA or version tag you tested against
  (`/api/version` returns this on any deployment).

## Scope

In scope:

- The ControlDesk web application (`src/**`, `proxy.ts`).
- Supabase migrations + RLS policies (`supabase/migrations/**`).
- Cron endpoints under `/api/cron/**`.
- The observability report endpoint `/api/observability/report`.
- The Docker image (`Dockerfile`, `docker-compose.yml`).

Out of scope:

- Third-party dependencies for which no patch exists — please report
  upstream and link the CVE here after.
- Findings in the demo seed data (`supabase/seed.sql`) — this is
  intentionally public sample data.
- Rate-limit noise (e.g. "the login form doesn't lock after 5 failed
  attempts") — see `src/lib/security/rate-limit.ts` for the actual
  policy; we welcome PRs to tighten it but it is not a P0 finding.

## Our response commitment

| Severity | Definition                                                     | Ack SLA  | Fix SLA  |
| -------- | -------------------------------------------------------------- | -------- | -------- |
| P0       | Cross-tenant data leak, auth bypass, PII exposure at rest      | 4 hours  | 48 hours |
| P1       | Privilege escalation, RLS bypass on a single tenant            | 24 hours | 7 days   |
| P2       | Session fixation, CSRF on read-only surface, log injection     | 72 hours | 30 days  |
| P3       | Cache leak, timing side channel, non-critical DoS              | 7 days   | 90 days  |

Rotation of any exposed secret follows [docs/ops/secret-rotation.md](docs/ops/secret-rotation.md).
Audit log preservation follows the 7-year window from rules §22.

## Coordinated disclosure

- We will credit reporters in the release notes and the security
  advisory unless they explicitly opt out.
- We do not currently run a paid bug-bounty programme.
- Please do not publicly disclose until we ship a fix and rotate any
  affected secrets. Compliance disclosure (UU ITE / PDP) is handled
  by the maintainers.

## Hardening surfaces that already ship

- **Row-Level Security** — Every tenant-scoped table verifies
  `tenant_id` via JWT claim (see `supabase/migrations/0003_rls_helpers.sql`).
- **Immutable audit trail** — `security_audit_logs` refuses UPDATE +
  DELETE via a BEFORE trigger (`0004_security_audit.sql`).
- **PDP / PEP** — Every mutating Server Action routes through
  `withSecureAction()` (`src/lib/security/action-wrapper.ts`).
- **Rate limiting** — Redis-backed fixed windows for auth, AI calls,
  cron endpoints, observability reports.
- **At-rest encryption** — HRIS PII columns encrypted with `pgcrypto`
  under `APP_ENCRYPTION_KEY`.
- **Observability redaction** — Sink adapters strip tokens, auth
  headers, and long hex/base64 strings before dispatch.
