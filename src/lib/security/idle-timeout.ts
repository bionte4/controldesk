/**
 * Idle timeout — env-driven configuration for the client-side idle timeout
 * feature (rules §3 defense-in-depth).
 *
 * ### Two knobs
 *
 * - `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` — total idle time (from last activity)
 *   after which the user is signed out and redirected to `/login`. Default
 *   30 minutes. Range [1, 1440] (1 min to 24 hours).
 *
 * - `NEXT_PUBLIC_IDLE_WARNING_MINUTES` — how many minutes BEFORE the final
 *   timeout the warning modal appears. Default 2 minutes. Must be strictly
 *   less than `IDLE_TIMEOUT_MINUTES` (otherwise the warning fires
 *   immediately and the UX makes no sense). Range [1, timeout - 1].
 *
 * ### Why env-driven
 *
 * A per-tenant setting would need a DB round-trip on every RSC layout
 * render, or a lookup keyed by tenant_id in the JWT. That's overkill for
 * an MVP guard. Env-driven means:
 *
 *   - Same policy across all tenants in this deployment (fine for MVP).
 *   - Ops can tune per-environment: dev = 8 hours (comfortable), staging =
 *     30 min (parity), prod = 15 min (aggressive) etc.
 *   - `NEXT_PUBLIC_*` is inlined at build time, so no runtime cost.
 *
 * If we later need per-tenant timeout (mis. HR tenant wants 10 min for
 * PII pages, marketing tenant wants 4 hours), we can:
 *
 *   1. Add `tenants.idle_timeout_minutes` column + migration.
 *   2. Read it in `(app)/layout.tsx` RSC.
 *   3. Pass to `IdleTimeoutProvider` — the provider already accepts numeric
 *      props, no client-side change needed.
 *
 * ### Non-goals
 *
 * - Server-side enforcement. This is UX defense-in-depth on top of Supabase's
 *   JWT expiry (`GOTRUE_JWT_EXP=3600`). A determined attacker with a stolen
 *   refresh token can still get an access token until the refresh token is
 *   revoked; the idle timeout mitigates the "walk away from unlocked laptop"
 *   scenario, not persistent-credential theft.
 */

const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_WARNING_MINUTES = 2;
const MIN_TIMEOUT_MINUTES = 1;
const MAX_TIMEOUT_MINUTES = 1440;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function resolveIdleTimeoutMinutes(): number {
  const value = readPositiveInt(
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES,
    DEFAULT_TIMEOUT_MINUTES,
  );
  return Math.min(MAX_TIMEOUT_MINUTES, Math.max(MIN_TIMEOUT_MINUTES, value));
}

export function resolveIdleWarningMinutes(): number {
  const timeout = resolveIdleTimeoutMinutes();
  const value = readPositiveInt(
    process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES,
    DEFAULT_WARNING_MINUTES,
  );
  // Clamp: warning must be at least 1 minute and strictly less than timeout.
  // If someone sets warning >= timeout, use max(1, timeout - 1) so we still
  // fire a warning shortly before the actual logout.
  return Math.max(1, Math.min(value, timeout - 1));
}
