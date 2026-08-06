/**
 * ControlDesk — Policy Decision Point (rules §3).
 *
 * Every Server Action / Route Handler that mutates data MUST call
 * `authorize()` before touching the database. Supabase RLS is the second
 * defensive line; PDP is the first.
 *
 * Design:
 *   - Pure function of `(actor, action, resource, attributes)` → decision.
 *   - No I/O: callers pass in already-loaded ABAC attributes so decisions
 *     are trivially testable and deterministic.
 *   - Unknown resource types fail closed (`DENY`), never fall through to
 *     allow-by-default.
 *
 * Resources currently modeled:
 *   `expense`, `cash_advance`, `cash_advance_settlement`,
 *   `petty_cash_fund`, `petty_cash_voucher`, `petty_cash_replenishment`,
 *   `hr_request`, `hr_request_sick`,
 *   `client`, `bpo_contract`,
 *   `project`, `project_pm_assignment`, `project_employee_assignment`,
 *   `project_budget`, `employee`, `audit_log`.
 *
 * Extend with additional cases as each rules §7-§13 module lands.
 */

import {
  isStaffRole,
  requiredApprovalChain,
  roleRank,
  type EmployeeRole,
} from "@/lib/rbac/roles";

type ApprovalLevel =
  | "L1_SUPERVISOR"
  | "L2_PROJECT_MANAGER"
  | "L2_5_FINANCE"
  | "L3_OPERATIONS_MANAGER"
  | "L4_HEAD_MANAGER"
  | "L5_GENERAL_MANAGER";

export type ActionVerb =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "submit"
  | "approve"
  | "reject"
  | "cancel"
  | "disburse"
  | "settle"
  | "export";

export type ResourceType =
  | "expense"
  | "cash_advance"
  | "cash_advance_settlement"
  | "petty_cash_fund"
  | "petty_cash_voucher"
  | "petty_cash_replenishment"
  | "hr_request"
  | "hr_request_sick"
  | "client"
  | "client_portal_user"
  | "bpo_contract"
  | "project"
  | "project_pm_assignment"
  | "project_employee_assignment"
  | "project_budget"
  | "pm_handover"
  | "ai_insight"
  | "work_shift"
  | "roster_entry"
  | "timesheet"
  | "payroll_period"
  | "employee"
  | "audit_log"
  | "data_archive"
  | "secret_rotation";

export type Actor = {
  userId: string;
  employeeId: string;
  role: EmployeeRole;
  tenantId: string;
};

export type ResourceAttributes = {
  /** Tenant that owns the resource. MUST equal actor.tenantId. */
  tenantId: string;
  /** Owner employee id (submitter / creator). Used for self-service policies. */
  ownerEmployeeId?: string;
  /** Project the resource belongs to, if any. */
  projectId?: string;
  /** Whether the actor is actively assigned to `projectId`. */
  isActiveAssignment?: boolean;
  /** Current approval / lifecycle status of the resource. */
  status?: string;
  /** Currency amount in IDR — drives the §9 threshold matrix. */
  amountIDR?: number;
  /** For approvals: which level in the chain is currently pending. */
  pendingApprovalLevel?:
    | "L1_SUPERVISOR"
    | "L2_PROJECT_MANAGER"
    | "L2_5_FINANCE"
    | "L3_OPERATIONS_MANAGER"
    | "L4_HEAD_MANAGER"
    | "L5_GENERAL_MANAGER";
};

export type Decision =
  | { effect: "ALLOW"; reason: string }
  | { effect: "DENY"; reason: string };

const ALLOW = (reason: string): Decision => ({ effect: "ALLOW", reason });
const DENY = (reason: string): Decision => ({ effect: "DENY", reason });

const OPERATIONAL_HIGH: readonly EmployeeRole[] = [
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
] as const;

const FINANCE_LIKE: readonly EmployeeRole[] = [
  "LEAD_FINANCE",
  "TENANT_ADMIN",
] as const;

const HR_LIKE: readonly EmployeeRole[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
] as const;

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------
export function authorize(input: {
  actor: Actor;
  action: ActionVerb;
  resource: ResourceType;
  attributes: ResourceAttributes;
}): Decision {
  const { actor, action, resource, attributes } = input;

  // --- 1. Tenant isolation — non-negotiable (rules §5). ---
  if (attributes.tenantId !== actor.tenantId) {
    return DENY("cross-tenant access blocked");
  }

  // --- 2. TENANT_ADMIN can do anything within their own tenant. ---
  if (actor.role === "TENANT_ADMIN") {
    return ALLOW("tenant admin override");
  }

  // --- 3. Read policies (default: allow within tenant). ---
  if (action === "read") {
    return allowReadWithinTenant(actor, resource, attributes);
  }

  // --- 4. Resource-specific write policies. ---
  switch (resource) {
    case "expense":
    case "cash_advance":
      return decideMoneyRequest(actor, action, attributes);
    case "cash_advance_settlement":
      return decideSettlement(actor, action, attributes);
    case "petty_cash_fund":
      return decidePettyCashFund(actor, action);
    case "petty_cash_voucher":
      return decidePettyCashVoucher(actor, action, attributes);
    case "petty_cash_replenishment":
      return decidePettyCashReplenishment(actor, action);
    case "hr_request":
    case "hr_request_sick":
      return decideHrRequest(actor, action, resource, attributes);
    case "client":
      return decideClient(actor, action);
    case "client_portal_user":
      return decideClientPortalUser(actor, action);
    case "bpo_contract":
      return decideBpoContract(actor, action);
    case "project":
      return decideProject(actor, action);
    case "project_pm_assignment":
    case "project_employee_assignment":
      return decideAssignment(actor, action);
    case "project_budget":
      return decideProjectBudget(actor, action);
    case "pm_handover":
      return decidePmHandover(actor, action, attributes);
    case "ai_insight":
      return decideAiInsight(actor, action);
    case "work_shift":
      return decideWorkShift(actor, action);
    case "roster_entry":
      return decideRosterEntry(actor, action);
    case "timesheet":
      return decideTimesheet(actor, action, attributes);
    case "payroll_period":
      return decidePayrollPeriod(actor, action);
    case "employee":
      return decideEmployee(actor, action, attributes);
    case "audit_log":
      return decideAuditLog(actor, action);
    case "data_archive":
      return decideDataArchive(actor, action);
    case "secret_rotation":
      return decideSecretRotation(actor, action);
    default:
      return DENY(`unknown resource type: ${resource satisfies never}`);
  }
}

// ---------------------------------------------------------------------------
// Read policy — mostly permissive within a tenant.
// ---------------------------------------------------------------------------
function allowReadWithinTenant(
  actor: Actor,
  resource: ResourceType,
  attrs: ResourceAttributes,
): Decision {
  if (resource === "audit_log") {
    return decideAuditLog(actor, "read");
  }
  // Payroll aggregates are restricted to HR / finance / admin only.
  if (resource === "payroll_period") {
    return decidePayrollPeriod(actor, "read");
  }
  // Data-archive registry is admin-only (contains storage paths + checksums).
  if (resource === "data_archive") {
    return decideDataArchive(actor, "read");
  }
  // Secret rotation registry — ops-only (rules §22).
  if (resource === "secret_rotation") {
    return decideSecretRotation(actor, "read");
  }

  // Self-service reads always allowed.
  if (attrs.ownerEmployeeId === actor.employeeId) {
    return ALLOW("self-service read");
  }
  return ALLOW("tenant-scoped read");
}

// ---------------------------------------------------------------------------
// Money requests — expenses + cash advances (rules §9).
// ---------------------------------------------------------------------------
function decideMoneyRequest(
  actor: Actor,
  action: ActionVerb,
  attrs: ResourceAttributes,
): Decision {
  switch (action) {
    case "create":
    case "submit": {
      // Any assigned employee can submit for a project they belong to.
      if (!attrs.projectId) return DENY("project_id required");
      if (!attrs.isActiveAssignment) return DENY("not actively assigned to project");
      return ALLOW("assigned employee may submit");
    }

    case "update":
    case "cancel": {
      // Only the submitter may edit / cancel, and only while still in DRAFT
      // or PENDING_L1 state. Higher states are locked.
      if (attrs.ownerEmployeeId !== actor.employeeId) {
        return DENY("only submitter may edit");
      }
      const openStates = new Set(["DRAFT", "PENDING_L1_SUPERVISOR"]);
      if (attrs.status && !openStates.has(attrs.status)) {
        return DENY(`resource is locked at status ${attrs.status}`);
      }
      return ALLOW("submitter edit while open");
    }

    case "approve":
    case "reject": {
      const level = attrs.pendingApprovalLevel;
      if (!level) return DENY("no pending approval level");

      // Finance parallel gate — Lead Finance only.
      if (level === "L2_5_FINANCE") {
        return FINANCE_LIKE.includes(actor.role)
          ? ALLOW("finance parallel gate")
          : DENY("only Lead Finance may act on finance gate");
      }

      const requiredRoleByLevel: Record<string, EmployeeRole> = {
        L1_SUPERVISOR: "SUPERVISOR",
        L2_PROJECT_MANAGER: "PROJECT_MANAGER",
        L3_OPERATIONS_MANAGER: "OPERATIONS_MANAGER",
        L4_HEAD_MANAGER: "HEAD_MANAGER",
        L5_GENERAL_MANAGER: "GENERAL_MANAGER",
      };
      const needed = requiredRoleByLevel[level];
      if (!needed) return DENY("unknown approval level");
      if (actor.role !== needed) {
        return DENY(`level ${level} requires ${needed} (actor is ${actor.role})`);
      }

      // A stale "L3_OPERATIONS_MANAGER" pending step must not slip through
      // if the amount is actually above the L3 bracket — the workflow engine
      // should have routed to L4/L5. This guards against workflow drift.
      if (attrs.amountIDR !== undefined) {
        const chain = requiredApprovalChain(attrs.amountIDR);
        const terminalRole =
          requiredRoleByLevel[chain[chain.length - 1] as ApprovalLevel];
        if (
          terminalRole &&
          roleRank(actor.role) > roleRank(terminalRole) &&
          actor.role !== "TENANT_ADMIN"
        ) {
          // The actor is HIGHER on the ladder than the terminal role for
          // this amount, meaning the request has been over-escalated.
          return DENY(
            `approval over-escalated: amount only requires up to ${chain[chain.length - 1]}`,
          );
        }
      }
      return ALLOW(`approver at ${level}`);
    }

    case "disburse": {
      return FINANCE_LIKE.includes(actor.role)
        ? ALLOW("finance disbursement")
        : DENY("only Lead Finance may disburse");
    }

    case "delete":
      return DENY("money requests are never deleted — cancel instead");

    default:
      return DENY(`unsupported action on money request: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Settlement (rules §11).
// ---------------------------------------------------------------------------
function decideSettlement(
  actor: Actor,
  action: ActionVerb,
  attrs: ResourceAttributes,
): Decision {
  if (action === "create" || action === "submit" || action === "update") {
    if (attrs.ownerEmployeeId !== actor.employeeId) {
      return DENY("only the cash advance owner may settle");
    }
    return ALLOW("owner settlement");
  }
  if (action === "settle") {
    return FINANCE_LIKE.includes(actor.role)
      ? ALLOW("finance approves settlement")
      : DENY("only Lead Finance may finalize settlement");
  }
  return DENY(`unsupported action on settlement: ${action}`);
}

// ---------------------------------------------------------------------------
// Petty cash (rules §10).
// ---------------------------------------------------------------------------
function decidePettyCashFund(actor: Actor, action: ActionVerb): Decision {
  if (action === "create" || action === "update" || action === "delete") {
    return FINANCE_LIKE.includes(actor.role)
      ? ALLOW("finance manages funds")
      : DENY("only Lead Finance may manage petty cash funds");
  }
  return DENY(`unsupported action on petty_cash_fund: ${action}`);
}

function decidePettyCashVoucher(
  actor: Actor,
  action: ActionVerb,
  attrs: ResourceAttributes,
): Decision {
  if (action === "create" || action === "submit") {
    return actor.role === "PETTY_CASH_CUSTODIAN" ||
      FINANCE_LIKE.includes(actor.role)
      ? ALLOW("custodian creates voucher")
      : DENY("only custodian / finance may spend petty cash");
  }
  if (action === "update" || action === "cancel") {
    if (attrs.ownerEmployeeId !== actor.employeeId) {
      return DENY("only the creating custodian may edit");
    }
    return ALLOW("custodian edit");
  }
  return DENY(`unsupported action on petty_cash_voucher: ${action}`);
}

function decidePettyCashReplenishment(
  actor: Actor,
  action: ActionVerb,
): Decision {
  if (action === "create" || action === "submit") {
    return actor.role === "PETTY_CASH_CUSTODIAN"
      ? ALLOW("custodian requests replenishment")
      : DENY("only custodian may request replenishment");
  }
  if (action === "approve" || action === "reject" || action === "disburse") {
    return FINANCE_LIKE.includes(actor.role)
      ? ALLOW("finance approves replenishment")
      : DENY("only Lead Finance may approve replenishment");
  }
  return DENY(`unsupported action on petty_cash_replenishment: ${action}`);
}

// ---------------------------------------------------------------------------
// HR requests (rules §12).
// ---------------------------------------------------------------------------
function decideHrRequest(
  actor: Actor,
  action: ActionVerb,
  resource: "hr_request" | "hr_request_sick",
  attrs: ResourceAttributes,
): Decision {
  if (action === "create" || action === "submit") {
    return isStaffRole(actor.role) || actor.role === "EMPLOYEE" ||
      actor.role === "SUPERVISOR" || actor.role === "PROJECT_MANAGER" ||
      actor.role === "OPERATIONS_MANAGER" ||
      actor.role === "HEAD_MANAGER" || actor.role === "GENERAL_MANAGER"
      ? ALLOW("employee submits HR request")
      : DENY("unknown submitter role");
  }
  if (action === "cancel" || action === "update") {
    if (attrs.ownerEmployeeId !== actor.employeeId) {
      return DENY("only requester may edit");
    }
    if (attrs.status && attrs.status !== "PENDING_L1_SUPERVISOR") {
      return DENY("only editable while pending L1");
    }
    return ALLOW("requester edit while open");
  }
  if (action === "approve" || action === "reject") {
    const level = attrs.pendingApprovalLevel;
    if (!level) return DENY("no pending level");

    if (resource === "hr_request_sick") {
      // Sick: Supervisor (L1) then HR Admin (Final).
      if (level === "L1_SUPERVISOR") {
        return actor.role === "SUPERVISOR"
          ? ALLOW("sick L1")
          : DENY("sick L1 needs SUPERVISOR");
      }
      return HR_LIKE.includes(actor.role)
        ? ALLOW("sick final")
        : DENY("sick final needs HR_ADMIN");
    }

    // Overtime / leave chain.
    switch (level) {
      case "L1_SUPERVISOR":
        return actor.role === "SUPERVISOR"
          ? ALLOW("hr L1")
          : DENY("L1 needs SUPERVISOR");
      case "L2_PROJECT_MANAGER":
        return actor.role === "PROJECT_MANAGER"
          ? ALLOW("hr L2")
          : DENY("L2 needs PROJECT_MANAGER");
      case "L3_OPERATIONS_MANAGER":
        return actor.role === "OPERATIONS_MANAGER"
          ? ALLOW("hr L3")
          : DENY("L3 needs OPERATIONS_MANAGER");
      default:
        return HR_LIKE.includes(actor.role)
          ? ALLOW("hr final")
          : DENY("final needs HR_ADMIN");
    }
  }
  return DENY(`unsupported action on hr_request: ${action}`);
}

// ---------------------------------------------------------------------------
// Clients (rules §6). CRUD gated to OM+ and TENANT_ADMIN; anyone in tenant
// can read (already handled by allowReadWithinTenant).
// ---------------------------------------------------------------------------
function decideClient(actor: Actor, action: ActionVerb): Decision {
  if (action === "create" || action === "update") {
    return OPERATIONAL_HIGH.includes(actor.role)
      ? ALLOW("ops-high manages clients")
      : DENY("only OM+ may manage clients");
  }
  if (action === "delete") {
    return actor.role === "GENERAL_MANAGER" || actor.role === "TENANT_ADMIN"
      ? ALLOW("GM/admin may delete clients")
      : DENY("only GM / TENANT_ADMIN may delete clients");
  }
  return DENY(`unsupported action on client: ${action}`);
}

// ---------------------------------------------------------------------------
// Client portal users (rules §28 B.4). Managed by the same personas that
// manage the client record itself: OM+ / TENANT_ADMIN. The "reset password"
// verb is modeled as `update` because it mutates a scalar column on an
// existing row (no new row is created).
// ---------------------------------------------------------------------------
function decideClientPortalUser(actor: Actor, action: ActionVerb): Decision {
  if (action === "create" || action === "update") {
    return OPERATIONAL_HIGH.includes(actor.role)
      ? ALLOW("ops-high manages client portal users")
      : DENY("only OM+ / TENANT_ADMIN may manage client portal users");
  }
  if (action === "delete") {
    return actor.role === "GENERAL_MANAGER" || actor.role === "TENANT_ADMIN"
      ? ALLOW("GM/admin may delete client portal users")
      : DENY("only GM / TENANT_ADMIN may delete client portal users");
  }
  return DENY(`unsupported action on client_portal_user: ${action}`);
}

// ---------------------------------------------------------------------------
// BPO contracts (rules §5). Only Lead Finance + HM+ can mutate; TENANT_ADMIN
// override handled at the top of authorize().
// ---------------------------------------------------------------------------
const CONTRACT_WRITERS: readonly EmployeeRole[] = [
  "LEAD_FINANCE",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
] as const;

function decideBpoContract(actor: Actor, action: ActionVerb): Decision {
  if (action === "create" || action === "update") {
    return CONTRACT_WRITERS.includes(actor.role)
      ? ALLOW("finance/HM+ manages contracts")
      : DENY("only Lead Finance / HM+ may manage contracts");
  }
  if (action === "delete") {
    return actor.role === "GENERAL_MANAGER" || actor.role === "TENANT_ADMIN"
      ? ALLOW("GM/admin may delete contracts")
      : DENY("only GM / TENANT_ADMIN may delete contracts");
  }
  return DENY(`unsupported action on bpo_contract: ${action}`);
}

// ---------------------------------------------------------------------------
// Projects / assignments / employees (rules §7).
// ---------------------------------------------------------------------------
function decideProject(actor: Actor, action: ActionVerb): Decision {
  if (action === "create" || action === "update" || action === "delete") {
    return OPERATIONAL_HIGH.includes(actor.role)
      ? ALLOW("ops-high manages projects")
      : DENY("only OM+ may manage projects");
  }
  return DENY(`unsupported action on project: ${action}`);
}

function decideAssignment(actor: Actor, action: ActionVerb): Decision {
  // PMs may assign employees to their own projects; OM+ can do PM assignments
  // and any employee assignment. Rules §7.
  if (action === "create" || action === "update" || action === "delete") {
    const canAssign: readonly EmployeeRole[] = [
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "TENANT_ADMIN",
    ];
    return canAssign.includes(actor.role)
      ? ALLOW("PM+ manages assignments")
      : DENY("only PM+ may manage assignments");
  }
  return DENY(`unsupported action on assignment: ${action}`);
}

// ---------------------------------------------------------------------------
// Project budgets (rules §7 / §9). Finance owns the numbers; ops can propose.
// ---------------------------------------------------------------------------
const BUDGET_WRITERS: readonly EmployeeRole[] = [
  "LEAD_FINANCE",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
] as const;

function decideProjectBudget(actor: Actor, action: ActionVerb): Decision {
  if (action === "create" || action === "update") {
    return BUDGET_WRITERS.includes(actor.role)
      ? ALLOW("finance / OM+ manages budgets")
      : DENY("only Finance / OM+ may set project budgets");
  }
  return DENY(`unsupported action on project_budget: ${action}`);
}

// ---------------------------------------------------------------------------
// PM handover (rules §13). Initiator is OM+; OM approves L1; HM approves L2;
// then anyone with OM+ can EXECUTE (the SQL fn is transactional).
// ---------------------------------------------------------------------------
const HANDOVER_INITIATORS: readonly EmployeeRole[] = [
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
] as const;

function decidePmHandover(
  actor: Actor,
  action: ActionVerb,
  attrs: ResourceAttributes,
): Decision {
  if (action === "create" || action === "submit") {
    return HANDOVER_INITIATORS.includes(actor.role)
      ? ALLOW("OM+ initiates handover")
      : DENY("only OM+ may initiate PM handover");
  }

  if (action === "cancel") {
    if (attrs.ownerEmployeeId === actor.employeeId) {
      return ALLOW("initiator may cancel own handover");
    }
    return HANDOVER_INITIATORS.includes(actor.role)
      ? ALLOW("OM+ may cancel handover")
      : DENY("only initiator or OM+ may cancel handover");
  }

  if (action === "approve" || action === "reject") {
    const status = attrs.status;
    if (status === "PENDING_OM") {
      return actor.role === "OPERATIONS_MANAGER"
        ? ALLOW("OM approves handover L1")
        : DENY("PENDING_OM requires OPERATIONS_MANAGER");
    }
    if (status === "PENDING_HM") {
      return actor.role === "HEAD_MANAGER"
        ? ALLOW("HM approves handover L2")
        : DENY("PENDING_HM requires HEAD_MANAGER");
    }
    return DENY(`handover is not in a pending approval state (status=${status})`);
  }

  // Execute maps to a dedicated verb — we reuse "settle" semantically
  // (custom terminal action). Restrict to OM+ so field agents can't fire.
  if (action === "settle") {
    return HANDOVER_INITIATORS.includes(actor.role)
      ? ALLOW("OM+ executes approved handover")
      : DENY("only OM+ may execute handover");
  }

  return DENY(`unsupported action on pm_handover: ${action}`);
}

// ---------------------------------------------------------------------------
// AI Insight (rules §15). Only managers + finance + admin can trigger the
// engine or view the results, because output may contain aggregated financial
// / operational signals that individual contributors shouldn't see.
// ---------------------------------------------------------------------------
const AI_INSIGHT_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "LEAD_FINANCE",
] as const;

function decideAiInsight(actor: Actor, action: ActionVerb): Decision {
  if (action === "read") {
    return AI_INSIGHT_ROLES.includes(actor.role)
      ? ALLOW("privileged role reads AI insights")
      : DENY("AI insights restricted to managers + finance + admin");
  }
  if (action === "create") {
    return AI_INSIGHT_ROLES.includes(actor.role)
      ? ALLOW("privileged role runs AI insight")
      : DENY("AI insights restricted to managers + finance + admin");
  }
  return DENY(`unsupported action on ai_insight: ${action}`);
}

// ---------------------------------------------------------------------------
// Roster + Timesheets + Payroll (rules §12 + §14).
// ---------------------------------------------------------------------------
const SHIFT_WRITERS: readonly EmployeeRole[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
] as const;

const ROSTER_WRITERS: readonly EmployeeRole[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "SUPERVISOR",
] as const;

const TIMESHEET_APPROVERS: readonly EmployeeRole[] = [
  "SUPERVISOR",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HR_ADMIN",
  "TENANT_ADMIN",
] as const;

const PAYROLL_WRITERS: readonly EmployeeRole[] = [
  "HR_ADMIN",
  "LEAD_FINANCE",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
] as const;

function decideWorkShift(actor: Actor, action: ActionVerb): Decision {
  if (action === "read") return ALLOW("shifts are tenant-wide reference");
  if (action === "create" || action === "update" || action === "delete") {
    return SHIFT_WRITERS.includes(actor.role)
      ? ALLOW("privileged role edits shifts")
      : DENY("only HR / management may edit shifts");
  }
  return DENY(`unsupported action on work_shift: ${action}`);
}

function decideRosterEntry(actor: Actor, action: ActionVerb): Decision {
  if (action === "read") return ALLOW("rosters are tenant-visible");
  if (action === "create" || action === "update" || action === "delete") {
    return ROSTER_WRITERS.includes(actor.role)
      ? ALLOW("privileged role edits roster")
      : DENY("only PM+ / supervisors / HR may edit roster");
  }
  return DENY(`unsupported action on roster_entry: ${action}`);
}

function decideTimesheet(
  actor: Actor,
  action: ActionVerb,
  attrs: ResourceAttributes,
): Decision {
  if (action === "read") return ALLOW("timesheets are tenant-visible");

  if (action === "submit" || action === "create" || action === "update") {
    // Own timesheet is always self-service; supervisors + HR may edit any.
    if (attrs.ownerEmployeeId === actor.employeeId) {
      return ALLOW("self timesheet entry");
    }
    return ROSTER_WRITERS.includes(actor.role)
      ? ALLOW("privileged role edits timesheet")
      : DENY("only self, PM+, supervisor, or HR may edit timesheet");
  }
  if (action === "approve" || action === "reject") {
    return TIMESHEET_APPROVERS.includes(actor.role)
      ? ALLOW("approver reviews timesheet")
      : DENY("only supervisor / PM+ / HR may approve timesheet");
  }
  return DENY(`unsupported action on timesheet: ${action}`);
}

function decidePayrollPeriod(actor: Actor, action: ActionVerb): Decision {
  if (action === "read") {
    return PAYROLL_WRITERS.includes(actor.role)
      ? ALLOW("privileged role reads payroll")
      : DENY("payroll restricted to HR / finance / admin");
  }
  if (action === "create" || action === "update" || action === "settle") {
    return PAYROLL_WRITERS.includes(actor.role)
      ? ALLOW("privileged role manages payroll")
      : DENY("only HR / finance / admin manage payroll");
  }
  return DENY(`unsupported action on payroll_period: ${action}`);
}

function decideEmployee(
  actor: Actor,
  action: ActionVerb,
  attrs: ResourceAttributes,
): Decision {
  if (action === "update" && attrs.ownerEmployeeId === actor.employeeId) {
    return ALLOW("self profile update");
  }
  if (action === "create" || action === "update" || action === "delete") {
    return HR_LIKE.includes(actor.role)
      ? ALLOW("HR manages employees")
      : DENY("only HR / admin may manage employees");
  }
  return DENY(`unsupported action on employee: ${action}`);
}

function decideAuditLog(actor: Actor, action: ActionVerb): Decision {
  if (action !== "read" && action !== "export") {
    return DENY("audit log is append-only via record_audit_log()");
  }
  const privileged: readonly EmployeeRole[] = [
    "TENANT_ADMIN",
    "GENERAL_MANAGER",
    "HEAD_MANAGER",
    "LEAD_FINANCE",
    "HR_ADMIN",
  ];
  return privileged.includes(actor.role)
    ? ALLOW("privileged role reads audit trail")
    : DENY("audit trail restricted to privileged roles");
}

// ---------------------------------------------------------------------------
// Data archives (rules §22). The registry contains signed storage paths +
// SHA-256 checksums for cold financial data — treat as sensitive ops
// infrastructure. Read/export/verify (update) are all admin-scoped; the
// registry rows themselves are immutable except for the two mutable columns
// (`status`, `purged_at`, `purged_row_count`, `restore_verified_at`) via the
// migration trigger.
// ---------------------------------------------------------------------------
const DATA_ARCHIVE_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

function decideDataArchive(actor: Actor, action: ActionVerb): Decision {
  const isPrivileged = DATA_ARCHIVE_ROLES.includes(actor.role);
  switch (action) {
    case "read":
      return isPrivileged
        ? ALLOW("privileged role reads data-archive registry")
        : DENY("data-archive registry restricted to admins + GM");
    case "export":
      return isPrivileged
        ? ALLOW("privileged role downloads archive blob")
        : DENY("data-archive downloads restricted to admins + GM");
    case "update":
      return actor.role === "TENANT_ADMIN"
        ? ALLOW("tenant admin may verify archive checksum")
        : DENY("data-archive verify restricted to TENANT_ADMIN");
    default:
      return DENY(`unsupported action on data_archive: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Secret rotation registry (rules §22 + docs/ops/secret-rotation.md).
// Cross-tenant infrastructure — only TENANT_ADMIN + GENERAL_MANAGER can
// even see it (they might operate multiple tenants and need visibility).
// Marking a secret rotated is TENANT_ADMIN only.
// ---------------------------------------------------------------------------
const SECRET_ROTATION_READERS: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

function decideSecretRotation(actor: Actor, action: ActionVerb): Decision {
  const isReader = SECRET_ROTATION_READERS.includes(actor.role);
  switch (action) {
    case "read":
      return isReader
        ? ALLOW("privileged role reads secret-rotation registry")
        : DENY("secret rotation registry restricted to admins + GM");
    case "update":
      return actor.role === "TENANT_ADMIN"
        ? ALLOW("tenant admin may mark secret rotated")
        : DENY("secret rotation write restricted to TENANT_ADMIN");
    default:
      return DENY(`unsupported action on secret_rotation: ${action}`);
  }
}
