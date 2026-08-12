import { headers } from "next/headers";

/**
 * Header names written by `proxy.ts` so downstream RSC / Server Actions can
 * cheaply read the resolved tenant without re-parsing the host or re-hitting
 * Supabase.
 */
export const TENANT_HEADER = "x-tenant-slug";
export const TENANT_ID_HEADER = "x-tenant-id";

export type TenantContext = {
  slug: string | null;
  id: string | null;
};

/**
 * Read the tenant that `proxy.ts` resolved for the current request. Returns
 * nulls on the apex/marketing surface. Callable from RSC + Server Actions.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const h = await headers();
  return {
    slug: h.get(TENANT_HEADER),
    id: h.get(TENANT_ID_HEADER),
  };
}

export async function requireTenantContext(): Promise<
  Required<TenantContext>
> {
  const ctx = await getTenantContext();
  if (!ctx.slug || !ctx.id) {
    throw new Error("Tenant context missing — this route must run under a tenant subdomain.");
  }
  return { slug: ctx.slug, id: ctx.id };
}
