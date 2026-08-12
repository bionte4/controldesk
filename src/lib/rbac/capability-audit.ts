import "server-only";

import { cache } from "react";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import {
  CAPABILITY_IDS,
  isCapabilityId,
  type CapabilityId,
} from "./capabilities";
import { EMPLOYEE_ROLES, type EmployeeRole } from "./roles";

/**
 * ControlDesk — Capability override audit trail loader
 * (rules §3 Fase 3B).
 *
 * Answers "who toggled this capability × role cell, when, and from
 * what to what?" for the admin history sheet at
 * `/settings/capabilities`. Data source is
 * `security_audit_logs.resource_name = 'tenant_capability_overrides'`
 * — the exact rows emitted by the three server actions in
 * `settings/capabilities/actions.ts`.
 *
 * ## Audit event shapes we decode
 *
 *   UPDATE (upsert cell)
 *     old_values = { id, granted }             // null on first grant
 *     new_values = { capability_id, role, granted }
 *     resource_id = tenant_capability_overrides.id
 *
 *   DELETE (reset one cell)
 *     old_values = { id, granted }
 *     new_values = { capability_id, role, cleared: true }
 *     resource_id = tenant_capability_overrides.id
 *
 *   DELETE (reset entire capability)
 *     old_values = { rows: [ { id, role, granted }, ... ] }
 *     new_values = { cleared: <count> }
 *     resource_id = capability_id  ← key detail
 *
 *  The "reset entire capability" case is the odd one out because it
 *  doesn't carry a role in `new_values`. We surface it as an entry
 *  with `role = null` and `kind = "reset_all"` so the UI can render
 *  a distinct "Reset all overrides (N cleared)" row.
 *
 * ## RLS trust
 *
 *   The read below is via the authenticated Supabase client, so
 *   RLS in `security_audit_logs` (migration 0004) already restricts
 *   rows to the caller's tenant AND to privileged roles
 *   (TENANT_ADMIN / GM / HM / LEAD_FINANCE / HR_ADMIN) OR the
 *   caller's own actions. We ALSO gate the enclosing server action
 *   on TENANT_ADMIN / GM before hitting this helper, giving defense
 *   in depth without duplicating the tenant filter here.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Discriminates the three audit event shapes for UI branching. */
export type CapabilityHistoryKind =
  | "grant"
  | "revoke"
  | "reset_cell"
  | "reset_all";

export type CapabilityHistoryEntry = {
  /** `security_audit_logs.id` as string, monotonically increasing. */
  id: string;
  /** Event kind — see `CapabilityHistoryKind` for the wire-shape → UI mapping. */
  kind: CapabilityHistoryKind;
  /** Capability being toggled. Always populated. */
  capabilityId: CapabilityId;
  /**
   * Role targeted by this event. `null` for `reset_all` (which
   * affects every role for that capability at once).
   */
  role: EmployeeRole | null;
  /**
   * The `granted` flag AFTER the mutation. `null` on reset events
   * (the cell reverts to catalog default, whose sign depends on the
   * role — the UI recomputes from the catalog).
   */
  granted: boolean | null;
  /** Number of rows removed by `reset_all`. Zero for other kinds. */
  clearedCount: number;
  /** ISO-8601 timestamp of the audit row. */
  createdAt: string;
  /**
   * Actor identity for display. All three fields may be `null` if
   * the employee row was deleted post-audit (audit table is
   * immutable, but the FK to `employees` is `on delete set null`).
   */
  actor: {
    employeeId: string | null;
    fullName: string | null;
    email: string | null;
  };
};

// ---------------------------------------------------------------------------
// Raw row shape from the join. Only shape guarantees; the resolver
// below narrows to the public `CapabilityHistoryEntry`.
// ---------------------------------------------------------------------------

type RawAuditRow = {
  id: number;
  action_type: string;
  resource_id: string | null;
  old_values: unknown;
  new_values: unknown;
  created_at: string;
  actor_employee_id: string | null;
  actor: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
};

function readString(obj: unknown, key: string): string | null {
  if (obj && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}

function readBoolean(obj: unknown, key: string): boolean | null {
  if (obj && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "boolean" ? value : null;
  }
  return null;
}

function readNumber(obj: unknown, key: string): number | null {
  if (obj && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "number" ? value : null;
  }
  return null;
}

function isEmployeeRole(value: string | null): value is EmployeeRole {
  return value !== null && (EMPLOYEE_ROLES as readonly string[]).includes(value);
}

/**
 * Decode one raw audit row into a UI-friendly `CapabilityHistoryEntry`.
 * Returns `null` if the row doesn't match any of the three known
 * shapes — defense against future schema drift.
 *
 * Exported for unit testing (`capability-audit.test.ts`); production
 * callers should use `loadCapabilityHistory` above.
 */
export function decodeCapabilityAuditRow(
  row: RawAuditRow,
): CapabilityHistoryEntry | null {
  const newValues = row.new_values;

  // Prefer capability_id from `new_values` (present in UPDATE + reset_cell).
  // Fall back to `resource_id` (used by reset_all).
  const capIdFromValues = readString(newValues, "capability_id");
  const capId = capIdFromValues ?? row.resource_id;
  if (!capId || !isCapabilityId(capId)) return null;

  const roleFromValues = readString(newValues, "role");
  const role = isEmployeeRole(roleFromValues) ? roleFromValues : null;

  const cleared = readBoolean(newValues, "cleared");
  const clearedCount = readNumber(newValues, "cleared") ?? 0;
  const granted = readBoolean(newValues, "granted");

  let kind: CapabilityHistoryKind;
  if (row.action_type === "UPDATE" && granted !== null) {
    kind = granted ? "grant" : "revoke";
  } else if (row.action_type === "DELETE" && cleared === true && role !== null) {
    kind = "reset_cell";
  } else if (row.action_type === "DELETE" && role === null) {
    kind = "reset_all";
  } else {
    // Old audit rows or future shapes we don't know about — skip
    // rather than surface as noise. If this fires, the smoke test
    // catches the drift.
    return null;
  }

  return {
    id: String(row.id),
    kind,
    capabilityId: capId,
    role,
    granted,
    clearedCount: kind === "reset_all" ? clearedCount : 0,
    createdAt: row.created_at,
    actor: {
      employeeId: row.actor?.id ?? row.actor_employee_id ?? null,
      fullName: row.actor?.full_name ?? null,
      email: row.actor?.email ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Public loaders
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/**
 * Load audit entries for a single capability. Optionally narrow by
 * role — includes both `role=X` events AND `reset_all` events
 * (since the latter clears every role for that capability).
 */
export const loadCapabilityHistory = cache(
  async (opts: {
    capabilityId: CapabilityId;
    role?: EmployeeRole;
    limit?: number;
  }): Promise<CapabilityHistoryEntry[]> => {
    const limit = Math.min(
      Math.max(1, opts.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const employee = await requireCurrentEmployee();
    const supabase = await createClient();

    // Postgrest's JSONB filter surface is thin (`->>` extraction
    // works, but `or` chains around it are fragile across driver
    // versions), and audit volume per tenant is small (dozens of
    // capability overrides over months). Pull a bounded page of
    // capability-override audit rows and narrow in memory. RLS
    // guarantees tenant scoping regardless of the driver quirks.
    const { data, error } = await supabase
      .from("security_audit_logs")
      .select(
        `
          id,
          action_type,
          resource_id,
          old_values,
          new_values,
          created_at,
          actor_employee_id,
          actor:employees!security_audit_logs_actor_employee_id_fkey (
            id,
            full_name,
            email
          )
        `,
      )
      .eq("tenant_id", employee.tenant_id)
      .eq("resource_name", "tenant_capability_overrides")
      .order("created_at", { ascending: false })
      .limit(MAX_LIMIT);

    if (error) {
      console.error("[capability-audit] load failed", error);
      return [];
    }

    const raw = (data ?? []) as unknown as RawAuditRow[];
    const decoded: CapabilityHistoryEntry[] = [];
    for (const row of raw) {
      const entry = decodeCapabilityAuditRow(row);
      if (!entry) continue;
      if (entry.capabilityId !== opts.capabilityId) continue;
      if (opts.role) {
        // Include: entries targeting this role OR reset_all events
        // (which affect every role including this one).
        if (entry.role !== null && entry.role !== opts.role) continue;
      }
      decoded.push(entry);
      if (decoded.length >= limit) break;
    }
    return decoded;
  },
);

/**
 * Summary counts across every capability — used by the matrix
 * header ("N overrides changed in the last 30 days") and to badge
 * capabilities that have recent activity. Only counts events for
 * IDs currently in the catalog.
 */
export const summariseCapabilityHistory = cache(
  async (opts: {
    sinceDaysAgo?: number;
  } = {}): Promise<Map<CapabilityId, number>> => {
    const employee = await requireCurrentEmployee();
    const supabase = await createClient();
    const since = new Date();
    since.setDate(since.getDate() - (opts.sinceDaysAgo ?? 30));

    const { data, error } = await supabase
      .from("security_audit_logs")
      .select("resource_id, new_values")
      .eq("tenant_id", employee.tenant_id)
      .eq("resource_name", "tenant_capability_overrides")
      .gte("created_at", since.toISOString())
      .limit(500);

    if (error) {
      console.error("[capability-audit] summary failed", error);
      return new Map();
    }

    const counts = new Map<CapabilityId, number>();
    for (const id of CAPABILITY_IDS) counts.set(id, 0);

    for (const row of data ?? []) {
      const fromValues = readString(row.new_values, "capability_id");
      const capId = fromValues ?? row.resource_id;
      if (!capId || !isCapabilityId(capId)) continue;
      counts.set(capId, (counts.get(capId) ?? 0) + 1);
    }
    return counts;
  },
);
