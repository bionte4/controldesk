<!--
  Thank you for contributing to ControlDesk. Please fill this template
  out completely — the security + audit requirements from the rulebook
  mean incomplete PRs will be rebounded.
-->

## Summary

<!-- 1-3 bullets. What did you change and why? -->

-
-

## Rulebook alignment

Which sections of `.cursorrules` does this PR touch? _(Delete rows that
don't apply.)_

- [ ] §2 Docker / Containerization
- [ ] §3 Security (RBAC / ABAC / PDP / Audit)
- [ ] §5 Multi-tenancy (RLS + JWT claim)
- [ ] §9 Value-based approval engine
- [ ] §10 Petty Cash
- [ ] §11 Cash Advance
- [ ] §12 HRIS (Overtime / Leave / Sick)
- [ ] §13 PM Handover
- [ ] §14 BPO analytics / Gross margin
- [ ] §15 AI Insights (with PII redact + cost cap)
- [ ] §17 Feature folder + Server Action contract
- [ ] §18 Money / Time / Locale hygiene
- [ ] §19 File storage (Supabase Storage RLS)
- [ ] §20 Notifications / Realtime / Digest
- [ ] §21 Observability + Testing
- [ ] §22 Retention / Migrations / Deployment
- [ ] §23 Accessibility (WCAG 2.2 AAA)

## Server Action contract (only if this PR touches a Server Action)

- [ ] All mutations use `withSecureAction({ schema, resource, action, auditAction, ... })`.
- [ ] `resolveAttributes` returns the correct `tenantId` + resource attributes.
- [ ] The handler returns `{ result, auditResourceId, auditOldValues, auditNewValues }`.
- [ ] `revalidatePath` / `revalidateTag` scoped to the tenant, not global.
- [ ] Zod schema lives under `src/lib/validation/[module].ts`.

## Migrations (only if this PR adds a `.sql` file)

- [ ] Filename follows `NNNN_short_snake_case.sql` (4-digit increment).
- [ ] New tables include a `tenant_id` column (except global lookup / infra tables — justify below).
- [ ] RLS is `enable`d and policies verify `tenant_id` via JWT claim.
- [ ] Index on `(tenant_id, …)` for the primary access pattern.
- [ ] Header comment includes a rollback SQL block.
- [ ] `src/types/database.ts` regenerated OR manually kept in sync.

## Tests

- [ ] Unit tests added / updated (`src/**/*.test.ts`).
- [ ] Coverage on `src/lib/security/**` still ≥ 80 % (`pnpm test:coverage`).
- [ ] Playwright suite added / updated (if this PR changes a critical flow).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass locally.

## Screenshots / demo (UI changes only)

<!-- Attach light + dark mode screenshots. GIFs preferred for interactive
     changes so reviewers can see motion + reduced-motion behaviour. -->

## Rollout notes

<!-- Describe any migration ordering, feature flags, env vars, or
     rollback runbook links. Leave "None" if this PR is a pure
     no-side-effect refactor. -->

## Linked issues

Closes #
