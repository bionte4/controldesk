import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Admin-managed reference-data domains. MUST stay in sync with the CHECK
 * constraint on `public.lookup_options.domain` (migrations 0049 + 0054).
 *
 * Domain roster:
 *   - Field Ops CA form (migration 0049):
 *       unit_pengaju, transport_need, area, rab_category
 *   - HR + Finance master data (migration 0054):
 *       department, position, budget_category
 */
export const LOOKUP_DOMAINS = [
  "unit_pengaju",
  "transport_need",
  "area",
  "rab_category",
  "department",
  "position",
  "budget_category",
] as const;

export type LookupDomain = (typeof LOOKUP_DOMAINS)[number];

export function isLookupDomain(v: string): v is LookupDomain {
  return (LOOKUP_DOMAINS as readonly string[]).includes(v);
}

export type LookupOption = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
};

/** Same as {@link LookupOption} + the fields the admin surface needs. */
export type AdminLookupOption = LookupOption & {
  domain: LookupDomain;
  is_active: boolean;
  updated_at: string;
};

/**
 * Load ACTIVE options for a single domain in the current tenant. RLS in
 * `lookup_options_tenant_read` makes this tenant-scoped automatically.
 * Wrapped in React `cache()` so repeat calls within one request dedupe.
 */
export const loadLookupOptions = cache(
  async (domain: LookupDomain): Promise<LookupOption[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lookup_options")
      .select("id, code, label, description, sort_order")
      .eq("domain", domain)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error || !data) return [];
    return data.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      description: row.description,
      sort_order: row.sort_order,
    }));
  },
);

/**
 * Load ALL lookup domains needed by the Field-Ops CA form in a single
 * round-trip. The form uses 4 domains (unit_pengaju / transport_need /
 * area / rab_category); returning them in one query keeps the sheet's
 * initial render tight.
 */
export const loadFieldOpsFormLookups = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lookup_options")
    .select("domain, id, code, label, description, sort_order")
    .in("domain", [...LOOKUP_DOMAINS])
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  const buckets: Record<LookupDomain, LookupOption[]> = {
    unit_pengaju: [],
    transport_need: [],
    area: [],
    rab_category: [],
    department: [],
    position: [],
    budget_category: [],
  };
  if (error || !data) return buckets;

  for (const row of data) {
    if (!isLookupDomain(row.domain)) continue;
    buckets[row.domain].push({
      id: row.id,
      code: row.code,
      label: row.label,
      description: row.description,
      sort_order: row.sort_order,
    });
  }
  return buckets;
});

/**
 * Admin view of all options across every domain, INCLUDING inactive rows
 * so the settings surface can render toggle switches. RLS still applies
 * (tenant-scoped) — writes are gated further by RLS + the PDP policy in
 * `pdp.ts::decideLookupOption`.
 */
export const loadAllLookupOptionsForAdmin = cache(async (): Promise<
  Record<LookupDomain, AdminLookupOption[]>
> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lookup_options")
    .select(
      "id, domain, code, label, description, sort_order, is_active, updated_at",
    )
    .in("domain", [...LOOKUP_DOMAINS])
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  const buckets: Record<LookupDomain, AdminLookupOption[]> = {
    unit_pengaju: [],
    transport_need: [],
    area: [],
    rab_category: [],
    department: [],
    position: [],
    budget_category: [],
  };
  if (error || !data) return buckets;

  for (const row of data) {
    if (!isLookupDomain(row.domain)) continue;
    buckets[row.domain].push({
      id: row.id,
      domain: row.domain,
      code: row.code,
      label: row.label,
      description: row.description,
      sort_order: row.sort_order,
      is_active: row.is_active,
      updated_at: row.updated_at,
    });
  }
  return buckets;
});
