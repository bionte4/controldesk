/**
 * ControlDesk — Cash Advance inbox filter helpers.
 *
 * The approvals inbox (`/approvals`) shows cash advances awaiting the
 * current employee's action. Because migration 0027 introduced canonical
 * PENDING_* statuses alongside the legacy PENDING_L* chain, the inbox
 * must query the UNION of both for as long as any legacy CA is still
 * in flight. This module isolates that union logic so the RSC page and
 * unit tests share one code path.
 *
 * NOTE: TENANT_ADMIN sees every pending status regardless of slot.
 */

import {
  CA_PENDING_APPROVAL_STATUSES,
  CA_STATUS_APPROVER_ROLE,
} from "@/lib/cash-advance/state";
import { canonicalCaPendingForRole } from "@/lib/cash-advance/state-canonical";
import type { AnyDbEmployeeRole, EmployeeRole } from "@/lib/rbac/roles";
import type { CashAdvanceStatus } from "@/types/database";

function legacyPendingForLegacyRole(role: EmployeeRole): CashAdvanceStatus[] {
  if (role === "TENANT_ADMIN") return [...CA_PENDING_APPROVAL_STATUSES];
  return CA_PENDING_APPROVAL_STATUSES.filter(
    (s) => CA_STATUS_APPROVER_ROLE[s] === role,
  );
}

/**
 * Merge legacy PENDING_L* statuses (looked up by exact legacy role) with
 * canonical PENDING_* statuses (looked up via canonical slot folding).
 * Order preserves the legacy set first for backward-compatible ordering,
 * then appends canonical entries the caller has not yet seen.
 */
export function mergedCaPendingForRole(
  role: AnyDbEmployeeRole,
): readonly CashAdvanceStatus[] {
  const legacy = legacyPendingForLegacyRole(role as EmployeeRole);
  const canonical = canonicalCaPendingForRole(role);
  const seen = new Set<CashAdvanceStatus>();
  const merged: CashAdvanceStatus[] = [];
  for (const s of [...legacy, ...canonical]) {
    if (!seen.has(s)) {
      seen.add(s);
      merged.push(s);
    }
  }
  return merged;
}
