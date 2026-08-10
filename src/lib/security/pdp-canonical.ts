/**
 * ControlDesk — Policy Decision Point (canonical / GAS-aligned layer).
 *
 * This module is the FORWARD-LOOKING PDP: it reasons in canonical 7-role
 * terms, uses the 3-tier approval matrix from `APPROVAL_CONFIG`
 * (`src/lib/rbac/roles.ts`), and supports tenant-scoped threshold overrides
 * via `resolveThresholds()` (rules §9).
 *
 * Design goals (Fase 0 slice 4):
 *   1. Additive — legacy `authorize()` in `pdp.ts` remains unchanged so the
 *      24 existing modules (expense / CA / HR / handover / …) keep working.
 *   2. Pure — decisions are deterministic from `(actor, action, resource,
 *      attributes)`. Tenant-scoped thresholds live in `attributes.thresholds`
 *      so callers can inject them from `resolveThresholds()`.
 *   3. Small — only models the NEW GAS resources that the legacy PDP
 *      doesn't already cover (milestones, budget, budget requests, field-ops
 *      CA, issues, weekly timesheet, portal). Legacy resources should keep
 *      using `authorize()` until they're rewritten.
 *
 * Callers should prefer this module when building any of the GAS-imported
 * modules listed in rules §15b.
 */

import {
  canonicalCanApprove,
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type CanonicalApprovalSlot,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import type { EffectiveThresholds } from "@/lib/rbac/thresholds";

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export type CanonicalActionVerb =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "submit"
  | "approve"
  | "reject"
  | "cancel"
  | "disburse"
  | "settle"
  | "export";

/**
 * Resources modelled by the canonical PDP. These correspond 1:1 with the
 * GAS-imported modules planned in `.cursorrules §15b` — legacy resources
 * (`expense`, `cash_advance`, …) intentionally stay on the legacy PDP for
 * now.
 */
export type CanonicalResource =
  | "project_milestone"
  | "project_task"
  | "budget"
  | "budget_detail"
  | "budget_request"
  | "cash_advance_general"
  | "cash_advance_field_ops"
  | "cash_advance_settlement"
  | "project_issue"
  | "weekly_timesheet"
  | "client_portal_view"
  | "approval_threshold"
  | "capability_override";

export type CanonicalActor = {
  userId: string;
  employeeId: string;
  /** Canonical role after folding the DB value via `toCanonicalRole()`. */
  role: CanonicalRole;
  tenantId: string;
};

export type CanonicalAttributes = {
  /** Tenant that owns the resource. MUST equal actor.tenantId (rules §5). */
  tenantId: string;
  /** Submitter / creator id — enables self-service policies. */
  ownerEmployeeId?: string;
  /** Project context (for milestone / budget / issue / timesheet). */
  projectId?: string;
  /** Whether the actor is actively assigned to `projectId`. */
  isActiveAssignment?: boolean;
  /** Lifecycle / approval status of the resource. */
  status?: string;
  /** Currency amount in IDR — drives the threshold matrix. */
  amountIDR?: number;
  /**
   * Cash advance sub-type discriminator — `GENERAL` (default) uses the
   * PM-first chain, `FIELD_OPS` starts at Supervisor (rules §9.4).
   * Read by the resource resolver to pick between
   * `cash_advance_general` and `cash_advance_field_ops`.
   */
  caType?: "GENERAL" | "FIELD_OPS";
  /**
   * Whether the actor is currently assigned as a FIELD_TECHNICIAN on any
   * project. Non-Supervisor employees may initiate a Field-Ops cash
   * advance only when this is true (mockup: "Pengajuan Operasional"
   * button is enabled for on-site technicians). Populated by the caller
   * via `has_active_field_tech_assignment(...)` RPC.
   */
  isFieldTech?: boolean;
  /**
   * Which canonical slot is currently pending. Approve/reject actions gate
   * on this via `canonicalCanApprove()`.
   */
  pendingSlot?: CanonicalApprovalSlot;
  /**
   * Effective per-tenant thresholds. Callers should load this via
   * `resolveThresholds(tenantId, kind)` from `src/lib/rbac/thresholds.ts`
   * BEFORE calling `authorizeCanonical()`. Optional — when omitted the PDP
   * skips threshold-based drift checks (still enforces slot/role rules).
   */
  thresholds?: EffectiveThresholds;
};

export type Decision =
  | { effect: "ALLOW"; reason: string }
  | { effect: "DENY"; reason: string };

const ALLOW = (reason: string): Decision => ({ effect: "ALLOW", reason });
const DENY = (reason: string): Decision => ({ effect: "DENY", reason });

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Build a `CanonicalActor` from a DB row shape. Accepts both legacy (10) and
 * canonical (7) role values in `role` and folds them to canonical.
 */
export function toCanonicalActor(input: {
  userId: string;
  employeeId: string;
  role: AnyDbEmployeeRole;
  tenantId: string;
}): CanonicalActor {
  return {
    userId: input.userId,
    employeeId: input.employeeId,
    role: toCanonicalRole(input.role),
    tenantId: input.tenantId,
  };
}

/**
 * Thin proxy on `canonicalCanApprove` that returns a `Decision` (the shape
 * `authorizeCanonical` uses) so callers can compose slot checks the same way
 * they compose PDP decisions.
 */
export function canDecideCanonical(
  actor: CanonicalActor,
  slot: CanonicalApprovalSlot,
): Decision {
  return canonicalCanApprove(actor.role, slot)
    ? ALLOW(`${actor.role} may act on slot ${slot}`)
    : DENY(`${actor.role} cannot act on slot ${slot}`);
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export function authorizeCanonical(input: {
  actor: CanonicalActor;
  action: CanonicalActionVerb;
  resource: CanonicalResource;
  attributes: CanonicalAttributes;
}): Decision {
  const { actor, action, resource, attributes } = input;

  // 1. Tenant isolation (rules §5) — non-negotiable, deny before anything else.
  if (attributes.tenantId !== actor.tenantId) {
    return DENY("cross-tenant access blocked");
  }

  // 2. ADMIN override — full authority within their own tenant (rules §6).
  if (actor.role === "ADMIN") {
    return ALLOW("admin override");
  }

  // 3. Approve / reject share a canonical slot check across every resource
  //    that participates in the amount-driven chain. Settlement rejections
  //    are Finance-only and don't touch the chain, so we let them fall
  //    through to their resource-specific policy below.
  if (
    (action === "approve" || action === "reject") &&
    resource !== "cash_advance_settlement"
  ) {
    return decideCanonicalApproval(actor, resource, attributes);
  }

  // 4. Reads default-allow within a tenant, with a handful of restricted
  //    resources (portal view, threshold registry).
  if (action === "read") {
    return decideCanonicalRead(actor, resource, attributes);
  }

  // 5. Resource-specific write policies.
  switch (resource) {
    case "project_milestone":
      return decideMilestone(actor, action, attributes);
    case "project_task":
      return decideProjectTask(actor, action, attributes);
    case "budget":
      return decideBudget(actor, action);
    case "budget_detail":
      return decideBudgetDetail(actor, action);
    case "budget_request":
      return decideBudgetRequest(actor, action, attributes);
    case "cash_advance_general":
      return decideGeneralCa(actor, action, attributes);
    case "cash_advance_field_ops":
      return decideFieldOpsCa(actor, action, attributes);
    case "cash_advance_settlement":
      return decideCaSettlement(actor, action, attributes);
    case "project_issue":
      return decideProjectIssue(actor, action, attributes);
    case "weekly_timesheet":
      return decideWeeklyTimesheet(actor, action, attributes);
    case "client_portal_view":
      return decideClientPortalView(actor, action);
    case "approval_threshold":
      return decideApprovalThreshold(actor, action);
    case "capability_override":
      return decideCapabilityOverride(actor, action);
    default: {
      const _never: never = resource;
      return DENY(`unknown canonical resource: ${String(_never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Approval — shared slot check + threshold drift detection.
// ---------------------------------------------------------------------------

function decideCanonicalApproval(
  actor: CanonicalActor,
  resource: CanonicalResource,
  attrs: CanonicalAttributes,
): Decision {
  const slot = attrs.pendingSlot;
  if (!slot) return DENY("no pending slot");

  if (!canonicalCanApprove(actor.role, slot)) {
    return DENY(`slot ${slot} requires higher canonical role than ${actor.role}`);
  }

  // Drift guard — if we have both a threshold config and the request amount,
  // reject when the actor is over-escalated (short-circuits above where the
  // amount actually requires action).
  if (
    attrs.amountIDR !== undefined &&
    attrs.thresholds !== undefined &&
    resource !== "project_milestone" &&
    resource !== "project_task" &&
    resource !== "client_portal_view" &&
    resource !== "approval_threshold" &&
    resource !== "capability_override"
  ) {
    const isOverEscalated = detectOverEscalation(actor.role, slot, attrs);
    if (isOverEscalated) {
      return DENY(
        `approval over-escalated: amount ${attrs.amountIDR} doesn't need slot ${slot}`,
      );
    }
  }

  return ALLOW(`${actor.role} decides on slot ${slot}`);
}

/**
 * True if the actor is trying to approve a slot that's HIGHER than the
 * amount actually requires. Prevents workflow drift where a Director signs
 * off on a Rp 500k expense that only needed FINANCE.
 *
 * The logic uses the threshold shape rather than the chain builder itself
 * to keep this file dependency-light (no chain-builder import).
 */
function detectOverEscalation(
  _actor: CanonicalRole,
  slot: CanonicalApprovalSlot,
  attrs: CanonicalAttributes,
): boolean {
  if (attrs.thresholds === undefined || attrs.amountIDR === undefined) {
    return false;
  }
  const t = attrs.thresholds;
  const amt = attrs.amountIDR;

  switch (slot) {
    case "DIRECTOR": {
      // Slot is Director. Amount must meet the director threshold for this kind.
      if (t.kind === "EXPENSE" || t.kind === "BUDGET" ||
          t.kind === "CASH_ADVANCE_GENERAL" ||
          t.kind === "CASH_ADVANCE_FIELD_OPS" ||
          t.kind === "BUDGET_REQUEST") {
        return amt < t.DIRECTOR_THRESHOLD;
      }
      return false;
    }
    case "OM": {
      if (t.kind === "CASH_ADVANCE_FIELD_OPS") {
        return amt < t.OM_THRESHOLD;
      }
      // OM slot only exists in the FieldOps chain; using it elsewhere is drift.
      return true;
    }
    case "PM": {
      if (t.kind === "EXPENSE" || t.kind === "CASH_ADVANCE_GENERAL" ||
          t.kind === "CASH_ADVANCE_FIELD_OPS" || t.kind === "BUDGET_REQUEST") {
        return amt < t.PM_THRESHOLD;
      }
      return false;
    }
    case "FINANCE":
    case "SUPERVISOR":
      // FINANCE is always the parallel gate; SUPERVISOR is always rung 0 of
      // FieldOps. Neither has a numeric threshold to over-escalate.
      return false;
  }
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

function decideCanonicalRead(
  actor: CanonicalActor,
  resource: CanonicalResource,
  attrs: CanonicalAttributes,
): Decision {
  if (resource === "approval_threshold") {
    // Anyone in the tenant can read the effective threshold config — it
    // drives the chain-preview UI. Tighter policies live in the DB (RLS).
    return ALLOW("tenant-scoped threshold read");
  }
  if (resource === "capability_override") {
    // Reading the override audit trail is restricted to the same admin
    // tier that can write it, so the history sheet on
    // `/settings/capabilities` isn't accessible to non-admins even via
    // a hand-rolled Server Action. Delegate to the write policy for
    // consistency.
    return decideCapabilityOverride(actor, "read");
  }
  if (resource === "client_portal_view") {
    // Portal views are inaccessible to employees; the portal has its own
    // auth surface (`client_users`).
    return DENY("client_portal_view is not readable from the employee app");
  }
  if (attrs.ownerEmployeeId === actor.employeeId) {
    return ALLOW("self-service read");
  }
  return ALLOW("tenant-scoped read");
}

// ---------------------------------------------------------------------------
// Milestones (rules §6 GAS align).
// ---------------------------------------------------------------------------

function decideMilestone(
  actor: CanonicalActor,
  action: CanonicalActionVerb,
  _attrs: CanonicalAttributes,
): Decision {
  if (action === "create" || action === "update") {
    return actor.role === "PM" || actor.role === "OM" ||
      actor.role === "DIRECTOR"
      ? ALLOW("PM/OM/Director edits milestones")
      : DENY("only PM / OM / DIRECTOR may edit milestones");
  }
  if (action === "delete") {
    return actor.role === "OM" || actor.role === "DIRECTOR"
      ? ALLOW("OM/Director deletes milestones")
      : DENY("only OM / DIRECTOR may delete milestones");
  }
  return DENY(`unsupported action on project_milestone: ${action}`);
}

// ---------------------------------------------------------------------------
// Project tasks (WBS — Phase 1 of the Work Breakdown Structure initiative).
//   - Mirrors milestone policy for CREATE/UPDATE/DELETE.
//   - `owner` update (task assignee) SHOULD stay editable by SUPERVISOR too
//     (team lead can re-assign work) but not by generic EMPLOYEE.
// ---------------------------------------------------------------------------
function decideProjectTask(
  actor: CanonicalActor,
  action: CanonicalActionVerb,
  _attrs: CanonicalAttributes,
): Decision {
  if (action === "create" || action === "update") {
    if (
      actor.role === "PM" ||
      actor.role === "OM" ||
      actor.role === "DIRECTOR" ||
      actor.role === "SUPERVISOR"
    ) {
      return ALLOW("Supervisor+ edits WBS tasks");
    }
    return DENY("only SUPERVISOR / PM / OM / DIRECTOR may edit WBS tasks");
  }
  if (action === "delete") {
    return actor.role === "PM" ||
      actor.role === "OM" ||
      actor.role === "DIRECTOR"
      ? ALLOW("PM+ deletes WBS tasks")
      : DENY("only PM / OM / DIRECTOR may delete WBS tasks");
  }
  return DENY(`unsupported action on project_task: ${action}`);
}

// ---------------------------------------------------------------------------
// Budgets (rules §9.2, GAS budget module).
// ---------------------------------------------------------------------------

function decideBudget(actor: CanonicalActor, action: CanonicalActionVerb): Decision {
  if (action === "create" || action === "update") {
    return actor.role === "PM" || actor.role === "OM" ||
      actor.role === "DIRECTOR" || actor.role === "FINANCE"
      ? ALLOW("PM+/Finance authors budgets")
      : DENY("only PM+ or Finance may author budgets");
  }
  if (action === "submit" || action === "cancel") {
    return actor.role === "PM" || actor.role === "OM" ||
      actor.role === "DIRECTOR"
      ? ALLOW("PM+ moves budget lifecycle")
      : DENY("only PM+ may move budget lifecycle");
  }
  if (action === "delete") {
    return actor.role === "DIRECTOR"
      ? ALLOW("Director deletes budgets")
      : DENY("only Director may delete budgets");
  }
  return DENY(`unsupported action on budget: ${action}`);
}

function decideBudgetDetail(actor: CanonicalActor, action: CanonicalActionVerb): Decision {
  // Budget line items follow the same rules as their parent budget.
  return decideBudget(actor, action);
}

// ---------------------------------------------------------------------------
// Budget requests — Increase / Decrease / Transfer (rules §9.6).
// ---------------------------------------------------------------------------

function decideBudgetRequest(
  actor: CanonicalActor,
  action: CanonicalActionVerb,
  attrs: CanonicalAttributes,
): Decision {
  if (action === "create" || action === "submit") {
    // Any active project member (assignment) may raise a request; PM/OM may
    // raise on any project of their org unit.
    if (actor.role === "PM" || actor.role === "OM" || actor.role === "DIRECTOR") {
      return ALLOW("PM+ raises budget request");
    }
    if (attrs.isActiveAssignment) {
      return ALLOW("assigned employee raises budget request");
    }
    return DENY("submitter not assigned to project");
  }
  if (action === "cancel") {
    if (attrs.ownerEmployeeId !== actor.employeeId) {
      return DENY("only requester may cancel budget request");
    }
    if (attrs.status && attrs.status !== "DRAFT" &&
        attrs.status !== "PENDING_PM" &&
        attrs.status !== "PENDING_FINANCE" &&
        attrs.status !== "PENDING_DIRECTOR") {
      return DENY(`budget request cannot be cancelled at status ${attrs.status}`);
    }
    return ALLOW("requester cancel while pending");
  }
  if (action === "update") {
    // `update` covers two distinct paths:
    //   1. Requester edits their own DRAFT / PENDING_PM row.
    //   2. Finance / PM+ applies an APPROVED request onto budget_details
    //      (server-side APPLY handler re-guards via role check).
    if (attrs.status === "APPROVED") {
      if (
        actor.role === "FINANCE" ||
        actor.role === "PM" ||
        actor.role === "OM" ||
        actor.role === "DIRECTOR"
      ) {
        return ALLOW("PM+/Finance applies approved budget request");
      }
      return DENY("only PM+/Finance may apply approved budget request");
    }
    if (attrs.ownerEmployeeId !== actor.employeeId) {
      return DENY("only requester may edit budget request");
    }
    if (attrs.status && attrs.status !== "DRAFT" &&
        attrs.status !== "PENDING_PM") {
      return DENY(`budget request locked at status ${attrs.status}`);
    }
    return ALLOW("requester edit while open");
  }
  return DENY(`unsupported action on budget_request: ${action}`);
}

// ---------------------------------------------------------------------------
// Cash Advance — General (rules §9.3). Any project member (assignment) may
// initiate; edits gated to owner while in DRAFT / PENDING_PM. Disbursement +
// settlement finalisation belong to Finance.
// ---------------------------------------------------------------------------

function decideGeneralCa(
  actor: CanonicalActor,
  action: CanonicalActionVerb,
  attrs: CanonicalAttributes,
): Decision {
  if (action === "create" || action === "submit") {
    if (!attrs.projectId) return DENY("project_id required");
    if (attrs.isActiveAssignment) {
      return ALLOW("assigned project member initiates general CA");
    }
    if (actor.role === "PM" || actor.role === "OM" ||
        actor.role === "DIRECTOR") {
      return ALLOW("PM+ may initiate on any project");
    }
    return DENY("submitter not assigned to project");
  }
  if (action === "update" || action === "cancel") {
    if (attrs.ownerEmployeeId !== actor.employeeId) {
      return DENY("only requester may edit general CA");
    }
    const editable = new Set(["DRAFT", "PENDING_PM"]);
    if (attrs.status && !editable.has(attrs.status)) {
      return DENY(`general CA locked at status ${attrs.status}`);
    }
    return ALLOW("requester edit while open");
  }
  if (action === "disburse") {
    return actor.role === "FINANCE"
      ? ALLOW("finance disburses general CA")
      : DENY("only Finance may disburse");
  }
  if (action === "settle") {
    return actor.role === "FINANCE"
      ? ALLOW("finance settles general CA")
      : DENY("only Finance may finalise settlement");
  }
  return DENY(`unsupported action on cash_advance_general: ${action}`);
}

// ---------------------------------------------------------------------------
// Cash Advance settlement — owner submits nota/struk, Finance
// accepts / returns. The parent CA is looked up via `attrs.projectId` /
// `attrs.ownerEmployeeId` to gate write access.
// ---------------------------------------------------------------------------

function decideCaSettlement(
  actor: CanonicalActor,
  action: CanonicalActionVerb,
  attrs: CanonicalAttributes,
): Decision {
  if (action === "create" || action === "submit") {
    return attrs.ownerEmployeeId === actor.employeeId
      ? ALLOW("owner submits settlement")
      : DENY("only CA owner may submit settlement");
  }
  if (action === "update") {
    return attrs.ownerEmployeeId === actor.employeeId
      ? ALLOW("owner amends draft settlement")
      : DENY("only owner may amend");
  }
  if (action === "settle") {
    return actor.role === "FINANCE"
      ? ALLOW("finance accepts settlement")
      : DENY("only Finance may accept settlement");
  }
  if (action === "reject") {
    return actor.role === "FINANCE"
      ? ALLOW("finance returns settlement")
      : DENY("only Finance may return settlement");
  }
  return DENY(`unsupported action on cash_advance_settlement: ${action}`);
}

// ---------------------------------------------------------------------------
// Cash Advance FieldOps (rules §9.4 / §27).
// ---------------------------------------------------------------------------

function decideFieldOpsCa(
  actor: CanonicalActor,
  action: CanonicalActionVerb,
  attrs: CanonicalAttributes,
): Decision {
  if (action === "create" || action === "submit") {
    if (!attrs.projectId) return DENY("project_id required");

    // (a) Supervisor / PM / OM / higher-rank actors always allowed —
    // matches the original "Supervisor-initiated" contract from rules
    // §9.4 and preserves escalation paths (Manager creating on behalf).
    if (
      actor.role === "SUPERVISOR" ||
      actor.role === "PM" ||
      actor.role === "OM" ||
      actor.role === "FINANCE" ||
      actor.role === "DIRECTOR" ||
      actor.role === "ADMIN"
    ) {
      return ALLOW("field-ops CA initiator (supervisor+)");
    }

    // (b) Base EMPLOYEE may initiate only when actively assigned as a
    // FIELD_TECHNICIAN on some project (mockup: "Pengajuan Operasional"
    // gated on-site staff). The caller populates `isFieldTech` from the
    // `has_active_field_tech_assignment()` RPC.
    if (actor.role === "EMPLOYEE" && attrs.isFieldTech === true) {
      return ALLOW("field-tech initiator");
    }

    return DENY("only supervisor+ or a field technician may initiate");
  }
  if (action === "update" || action === "cancel") {
    if (attrs.ownerEmployeeId !== actor.employeeId) {
      return DENY("only initiator may edit");
    }
    const editable = new Set(["DRAFT", "PENDING_SUPERVISOR"]);
    if (attrs.status && !editable.has(attrs.status)) {
      return DENY(`field-ops CA locked at status ${attrs.status}`);
    }
    return ALLOW("initiator edit while open");
  }
  if (action === "disburse") {
    return actor.role === "FINANCE"
      ? ALLOW("finance disburses field-ops CA")
      : DENY("only Finance may disburse");
  }
  if (action === "settle") {
    // Settlement finalisation belongs to Finance; employee submits evidence
    // via the settlement resource (future).
    return actor.role === "FINANCE"
      ? ALLOW("finance settles field-ops CA")
      : DENY("only Finance may finalise settlement");
  }
  return DENY(`unsupported action on cash_advance_field_ops: ${action}`);
}

// ---------------------------------------------------------------------------
// Project Issues (rules §15b — GAS Issues module, SLA-tracked).
// ---------------------------------------------------------------------------

function decideProjectIssue(
  actor: CanonicalActor,
  action: CanonicalActionVerb,
  attrs: CanonicalAttributes,
): Decision {
  if (action === "create" || action === "submit") {
    if (attrs.isActiveAssignment) return ALLOW("assigned member raises issue");
    if (actor.role === "PM" || actor.role === "OM" ||
        actor.role === "DIRECTOR") {
      return ALLOW("PM+ raises issue on any project");
    }
    return DENY("submitter not assigned to project");
  }
  if (action === "update") {
    if (attrs.ownerEmployeeId === actor.employeeId) {
      return ALLOW("reporter edits their own issue");
    }
    if (actor.role === "PM" || actor.role === "OM" ||
        actor.role === "DIRECTOR" || actor.role === "SUPERVISOR") {
      return ALLOW("supervisor/PM+ triages issue");
    }
    return DENY("only reporter or supervisor+ may edit issue");
  }
  if (action === "delete") {
    return actor.role === "PM" || actor.role === "OM" ||
      actor.role === "DIRECTOR"
      ? ALLOW("PM+ may retract issue")
      : DENY("only PM+ may retract issue");
  }
  return DENY(`unsupported action on project_issue: ${action}`);
}

// ---------------------------------------------------------------------------
// Weekly Timesheet (rules §15b — GAS Weekly Timesheet module).
// ---------------------------------------------------------------------------

function decideWeeklyTimesheet(
  actor: CanonicalActor,
  action: CanonicalActionVerb,
  attrs: CanonicalAttributes,
): Decision {
  if (action === "create" || action === "submit" || action === "update") {
    if (attrs.ownerEmployeeId === actor.employeeId) {
      return ALLOW("self weekly-timesheet edit");
    }
    if (actor.role === "SUPERVISOR" || actor.role === "PM" ||
        actor.role === "OM") {
      return ALLOW("supervisor/PM/OM edits team weekly-timesheet");
    }
    return DENY("only self or supervisor/PM/OM may edit weekly timesheet");
  }
  if (action === "cancel") {
    if (attrs.ownerEmployeeId === actor.employeeId) {
      return ALLOW("self weekly-timesheet cancel");
    }
    return DENY("only submitter may cancel weekly timesheet");
  }
  return DENY(`unsupported action on weekly_timesheet: ${action}`);
}

// ---------------------------------------------------------------------------
// Client Portal view (rules §28).
// ---------------------------------------------------------------------------

function decideClientPortalView(actor: CanonicalActor, action: CanonicalActionVerb): Decision {
  // Employees are not permitted to view "as the client". Only ADMIN can
  // manage portal user accounts (create / update / delete) — everyone else
  // is denied.
  if (action === "create" || action === "update" || action === "delete") {
    return actor.role === "ADMIN"
      ? ALLOW("admin manages client portal users")
      : DENY("only ADMIN may manage client portal");
  }
  return DENY(`unsupported action on client_portal_view: ${action}`);
}

// ---------------------------------------------------------------------------
// Approval threshold config (rules §9 + migration 0024).
// ---------------------------------------------------------------------------

function decideApprovalThreshold(actor: CanonicalActor, action: CanonicalActionVerb): Decision {
  if (action === "create" || action === "update") {
    return actor.role === "ADMIN" || actor.role === "DIRECTOR"
      ? ALLOW("admin/director tunes thresholds")
      : DENY("only ADMIN / DIRECTOR may tune thresholds");
  }
  if (action === "delete") {
    return actor.role === "ADMIN"
      ? ALLOW("admin removes threshold override")
      : DENY("only ADMIN may remove threshold override");
  }
  return DENY(`unsupported action on approval_threshold: ${action}`);
}

// ---------------------------------------------------------------------------
// Capability override matrix (rules §3 Fase 2, migration 0081).
// ---------------------------------------------------------------------------

function decideCapabilityOverride(actor: CanonicalActor, action: CanonicalActionVerb): Decision {
  // Same policy shape as `approval_threshold`: create/update require
  // ADMIN or DIRECTOR (`GENERAL_MANAGER` folds to DIRECTOR post-Fase 0),
  // delete requires ADMIN. RLS on `tenant_capability_overrides`
  // (migration 0081) enforces the same restriction at the row layer.
  //
  // The `read` action is gated to the same admin tier so the audit
  // history sheet at `/settings/capabilities` can't be scraped by
  // non-privileged callers via a hand-rolled Server Action call.
  // RLS on `security_audit_logs` (migration 0004) provides a second
  // wall for the underlying rows.
  if (action === "read") {
    return actor.role === "ADMIN" || actor.role === "DIRECTOR"
      ? ALLOW("admin/director reads capability override history")
      : DENY("only ADMIN / DIRECTOR may read capability override history");
  }
  if (action === "create" || action === "update") {
    return actor.role === "ADMIN" || actor.role === "DIRECTOR"
      ? ALLOW("admin/director tunes capability matrix")
      : DENY("only ADMIN / DIRECTOR may tune capability matrix");
  }
  if (action === "delete") {
    return actor.role === "ADMIN"
      ? ALLOW("admin removes capability override")
      : DENY("only ADMIN may remove capability override");
  }
  return DENY(`unsupported action on capability_override: ${action}`);
}
