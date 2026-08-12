import { redirect } from "next/navigation";

/**
 * Root of the platform-admin surface (rules §3, migration 0077).
 *
 * The `(super-admin)` route group intentionally has no dashboard at
 * `/super-admin` — all admin work happens in one of the four
 * sub-surfaces below. This page just funnels visitors to the tenant
 * list so bookmarking the bare root URL, or arriving from a stale
 * link, doesn't fall through to the tenant `(app)` catch-all (which
 * would render a misleading "coming soon" placeholder).
 *
 * The parent layout still enforces `requirePlatformAdmin()`, so
 * unauthenticated visitors and non-admins never see this redirect —
 * they're bounced to `/login?next=/super-admin` or
 * `/?error=not_platform_admin` before the RSC even runs.
 */
export default function SuperAdminIndexPage(): never {
  redirect("/super-admin/tenants");
}
