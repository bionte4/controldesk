import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reference resolver for bulk imports.
 *
 * Ref types encountered across the 4 supported resources:
 *   - lookup_options domain (department, position, budget_category)
 *   - clients            (by `contract_number`, `project_code`, or `name`)
 *   - projects           (by `code`)
 *   - chart_of_accounts  (by `code`)
 *   - budgets            (by (project_id, fiscal_year) APPROVED)
 *   - employees          (by `email`, for upsert / owner ref)
 *
 * Design: preload each map ONCE at the start of a job, then resolve
 * per-row using O(1) `Map.get`. Missing codes are stored in the
 * job's `errors[]` and cause row rejection.
 */

export type ResolverMaps = {
  lookupByDomainCode: Map<string, Map<string, string>>; // domain → (code → id)
  clientByKey: Map<string, string>; // client identifier (see keyClient()) → id
  projectByCode: Map<string, string>; // code → id
  coaByCode: Map<string, string>; // code → id
  budgetByProjectYear: Map<string, string>; // `${projectId}:${year}` → id
  employeeByEmail: Map<string, string>; // lower(email) → id
};

const LOOKUP_DOMAINS_TO_PRELOAD = [
  "department",
  "position",
  "budget_category",
  "unit_pengaju",
  "area",
  "rab_category",
] as const;

/**
 * Load the reference maps that a given resource type will need. Skip
 * unused domains to keep first-hit latency low.
 */
export async function loadResolverMaps(
  supabase: SupabaseClient,
  tenantId: string,
  needs: {
    lookups?: boolean;
    clients?: boolean;
    projects?: boolean;
    coa?: boolean;
    budgets?: boolean;
    employees?: boolean;
  },
): Promise<ResolverMaps> {
  const empty: ResolverMaps = {
    lookupByDomainCode: new Map(),
    clientByKey: new Map(),
    projectByCode: new Map(),
    coaByCode: new Map(),
    budgetByProjectYear: new Map(),
    employeeByEmail: new Map(),
  };

  const tasks: Promise<void>[] = [];

  if (needs.lookups) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("lookup_options")
          .select("domain, code, id, is_active")
          .in("domain", LOOKUP_DOMAINS_TO_PRELOAD as unknown as string[])
          .eq("is_active", true);
        for (const row of data ?? []) {
          const domain = row.domain as string;
          const code = normalizeCode((row as { code: string }).code);
          const id = (row as { id: string }).id;
          let bucket = empty.lookupByDomainCode.get(domain);
          if (!bucket) {
            bucket = new Map();
            empty.lookupByDomainCode.set(domain, bucket);
          }
          bucket.set(code, id);
        }
      })(),
    );
  }

  if (needs.clients) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("clients")
          .select("id, name, contract_number, project_code")
          .eq("tenant_id", tenantId);
        for (const row of data ?? []) {
          const r = row as {
            id: string;
            name: string;
            contract_number: string | null;
            project_code: string | null;
          };
          if (r.contract_number) {
            empty.clientByKey.set(
              keyClient(r.contract_number),
              r.id,
            );
          }
          if (r.project_code) {
            empty.clientByKey.set(keyClient(r.project_code), r.id);
          }
          empty.clientByKey.set(keyClient(r.name), r.id);
        }
      })(),
    );
  }

  if (needs.projects) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("projects")
          .select("id, code")
          .eq("tenant_id", tenantId);
        for (const row of data ?? []) {
          const r = row as { id: string; code: string };
          empty.projectByCode.set(normalizeCode(r.code), r.id);
        }
      })(),
    );
  }

  if (needs.coa) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("chart_of_accounts")
          .select("id, code, is_active")
          .eq("tenant_id", tenantId)
          .eq("is_active", true);
        for (const row of data ?? []) {
          const r = row as { id: string; code: string };
          empty.coaByCode.set(normalizeCode(r.code), r.id);
        }
      })(),
    );
  }

  if (needs.budgets) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("budgets")
          .select("id, project_id, fiscal_year, status")
          .eq("tenant_id", tenantId)
          .in("status", ["APPROVED", "DRAFT"]);
        // Prefer APPROVED — if both exist for (project, year), APPROVED
        // overwrites DRAFT because we walk APPROVED last.
        const draft: { id: string; project_id: string; fiscal_year: number }[] = [];
        const approved: { id: string; project_id: string; fiscal_year: number }[] = [];
        for (const row of data ?? []) {
          const r = row as {
            id: string;
            project_id: string;
            fiscal_year: number;
            status: string;
          };
          if (r.status === "APPROVED") approved.push(r);
          else draft.push(r);
        }
        for (const r of [...draft, ...approved]) {
          empty.budgetByProjectYear.set(
            `${r.project_id}:${r.fiscal_year}`,
            r.id,
          );
        }
      })(),
    );
  }

  if (needs.employees) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("employees")
          .select("id, email")
          .eq("tenant_id", tenantId);
        for (const row of data ?? []) {
          const r = row as { id: string; email: string };
          empty.employeeByEmail.set(r.email.toLowerCase().trim(), r.id);
        }
      })(),
    );
  }

  await Promise.all(tasks);
  return empty;
}

// ---------------------------------------------------------------------------
// Small helpers so import adapters can resolve without repeating logic.
// ---------------------------------------------------------------------------

export function normalizeCode(s: string): string {
  return s.trim().toUpperCase();
}

export function keyClient(s: string): string {
  return s.trim().toLowerCase();
}

export function resolveLookup(
  maps: ResolverMaps,
  domain: string,
  code: string,
): string | undefined {
  return maps.lookupByDomainCode.get(domain)?.get(normalizeCode(code));
}

export function resolveClient(
  maps: ResolverMaps,
  identifier: string,
): string | undefined {
  return maps.clientByKey.get(keyClient(identifier));
}

export function resolveProject(
  maps: ResolverMaps,
  code: string,
): string | undefined {
  return maps.projectByCode.get(normalizeCode(code));
}

export function resolveCoa(
  maps: ResolverMaps,
  code: string,
): string | undefined {
  return maps.coaByCode.get(normalizeCode(code));
}

export function resolveEmployeeByEmail(
  maps: ResolverMaps,
  email: string,
): string | undefined {
  return maps.employeeByEmail.get(email.toLowerCase().trim());
}
