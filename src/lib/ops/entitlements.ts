import "server-only";

import { log } from "@/lib/observability/log";

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

type CountQuery = PromiseLike<CountResult> & {
  select: (columns: string, options: { count: "exact"; head: true }) => CountQuery;
  eq: (column: string, value: unknown) => CountQuery;
  in: (column: string, values: string[]) => CountQuery;
};

type QueryClient = {
  rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
  from: (table: string) => CountQuery;
};

/**
 * Enforce a numeric package limit at mutation time. Feature flags are not
 * consulted here: this is a contractual entitlement boundary.
 */
export async function assertTenantCapacity(args: {
  client: unknown;
  tenantId: string;
  capability: "active_users" | "active_projects" | "portal_users";
  table: "employees" | "projects" | "client_users";
  activeFilter?: { column: string; values?: string[]; equals?: unknown };
}) {
  const client = args.client as QueryClient;
  const entitlementResult = await client.rpc("resolve_tenant_entitlement", {
    p_tenant: args.tenantId,
    p_capability: args.capability,
  });
  if (entitlementResult.error) {
    // Safe during rolling migration; once 0104 is installed, all new writes
    // are enforced. The warning keeps the operational gap observable.
    log.warn("entitlement capacity lookup unavailable", {
      tenant_id: args.tenantId,
      capability: args.capability,
      error: entitlementResult.error.message,
    });
    return;
  }
  const row = Array.isArray(entitlementResult.data)
    ? entitlementResult.data[0]
    : entitlementResult.data;
  const entitlement = row as { enabled?: boolean; limit_value?: number | null } | null;
  if (!entitlement?.enabled) {
    throw new Error(`Capability '${args.capability}' tidak termasuk dalam paket tenant.`);
  }
  if (entitlement.limit_value == null) return;

  let query = client
    .from(args.table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", args.tenantId);
  if (args.activeFilter?.values) {
    query = query.in(args.activeFilter.column, args.activeFilter.values);
  } else if (args.activeFilter) {
    query = query.eq(args.activeFilter.column, args.activeFilter.equals);
  }
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  if ((result.count ?? 0) >= entitlement.limit_value) {
    throw new Error(
      `Limit paket untuk ${args.capability} sudah tercapai (${result.count}/${entitlement.limit_value}). Hubungi admin platform untuk upgrade atau override.`,
    );
  }
}
