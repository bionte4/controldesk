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
  canManageKnowledgeArticles,
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
  | "export"
  | "bulk_import";

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
  | "secret_rotation"
  | "calendar_sync"
  | "telegram_bot_config"
  | "whatsapp_config"
  | "smtp_config"
  | "ai_config"
  | "lookup_option"
  | "user_admin"
  | "coa"
  | "evaluation"
  | "evaluation_template"
  | "upk_note"
  | "knowledge_article"
  | "monthly_report"
  | "report"
  | "import_job";

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
      return decidePmAssignment(actor, action);
    case "project_employee_assignment":
      return decideEmployeeAssignment(actor, action);
    case "project_budget":
      return decideProjectBudget(actor, action);
    case "pm_handover":
      return decidePmHandover(actor, action, attributes);
    case "ai_insight":
      return decideAiInsight(actor, action);
    case "work_shift":
      return decideWorkShift(actor, action, attributes);
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
    case "calendar_sync":
      return decideCalendarSync(actor, action);
    case "telegram_bot_config":
      return decideTelegramBotConfig(actor, action);
    case "whatsapp_config":
      return decideWhatsAppConfig(actor, action);
    case "smtp_config":
      return decideSmtpConfig(actor, action);
    case "ai_config":
      return decideAiConfig(actor, action);
    case "lookup_option":
      return decideLookupOption(actor, action);
    case "user_admin":
      return decideUserAdmin(actor, action);
    case "coa":
      return decideCoa(actor, action);
    case "evaluation_template":
      return decideEvaluationTemplate(actor, action);
    case "evaluation":
      return decideEvaluation(actor, action, attributes);
    case "upk_note":
      return decideUpkNote(actor, action, attributes);
    case "knowledge_article":
      return decideKnowledgeArticle(actor, action, attributes);
    case "monthly_report":
      return decideMonthlyReport(actor, action, attributes);
    case "report":
      return decideReport(actor, action);
    case "import_job":
      return decideImportJob(actor, action);
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
  // Google Calendar sync outbox — admin/GM only (contains project + tenant
  // configuration; RLS already deny-all for other roles).
  if (resource === "calendar_sync") {
    return decideCalendarSync(actor, "read");
  }
  // Tenant Telegram bot config — admin/GM only. Row contains an
  // encrypted bot token which the admin form loader (`loadTenantBotConfig`)
  // decrypts server-side; PDP guards the surface so non-admins never
  // hit the loader in the first place.
  if (resource === "telegram_bot_config") {
    return decideTelegramBotConfig(actor, "read");
  }
  // Tenant WhatsApp Business config — same admin-only gate as Telegram.
  if (resource === "whatsapp_config") {
    return decideWhatsAppConfig(actor, "read");
  }
  // Tenant SMTP config — per-tenant outbound-email transport identity.
  // Same admin-only gate as the other messaging integrations.
  if (resource === "smtp_config") {
    return decideSmtpConfig(actor, "read");
  }
  // Tenant AI provider config — per-tenant LLM + API key + model choice.
  if (resource === "ai_config") {
    return decideAiConfig(actor, "read");
  }
  // Lookup options are tenant-scoped reference data — any tenant member
  // may read (dropdowns everywhere). Write restricted below.
  if (resource === "lookup_option") {
    return ALLOW("lookup options readable by any tenant member");
  }
  // User admin surface — visible only to admin roles. Non-admins already get
  // an empty result from the RPC (defense-in-depth), but we keep the PDP in
  // sync so any server action or `authorize()` call at a page boundary also
  // enforces the same rule.
  if (resource === "user_admin") {
    return decideUserAdmin(actor, "read");
  }
  // Chart of Accounts is tenant-scoped master data — any tenant member may
  // read for dropdowns / display; write is restricted below.
  if (resource === "coa") {
    return ALLOW("coa readable by any tenant member");
  }
  // Analytical reports are gated to PM+/Finance/Custodian per rules §15b.
  // EMPLOYEE and SUPERVISOR must be denied even for read — a report is
  // aggregate financial data, not their own operational record.
  if (resource === "report") {
    return decideReport(actor, "read");
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
      // (a) Trusted operations ladder may re-code (assign MA, adjust
      // notes) any non-terminal money request. This is the "approver
      // reclassifies before advancing" path — Employee submits without
      // MA, PM/Finance codes it during review. Cancel is NOT part of
      // this branch (only the submitter can withdraw).
      const TRUSTED_MA_EDITORS: readonly EmployeeRole[] = [
        "PROJECT_MANAGER",
        "LEAD_FINANCE",
        "OPERATIONS_MANAGER",
        "HEAD_MANAGER",
        "GENERAL_MANAGER",
      ];
      const terminalStates = new Set(["APPROVED", "REJECTED", "CANCELLED"]);
      if (action === "update" && TRUSTED_MA_EDITORS.includes(actor.role)) {
        if (attrs.status && terminalStates.has(attrs.status)) {
          return DENY(`resource is locked at status ${attrs.status}`);
        }
        return ALLOW("PM+/Finance may re-code non-terminal money request");
      }

      // (b) Submitter self-service edit / cancel while still open.
      if (attrs.ownerEmployeeId !== actor.employeeId) {
        return DENY("only submitter may edit");
      }
      // Legacy: DRAFT / PENDING_L1_SUPERVISOR. Canonical (GAS-aligned)
      // rows use PENDING_SUPERVISOR — treat as functionally equivalent
      // for the "still with first-line" window that lets submitters
      // patch metadata + supporting attachments before Supervisor
      // triage. Anything past first-line is frozen.
      const openStates = new Set([
        "DRAFT",
        "PENDING_L1_SUPERVISOR",
        "PENDING_SUPERVISOR",
      ]);
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
  // update = attach/detach supporting docs (memo pendukung, transfer
  // proof). Custodian handles memo at request time; Lead Finance
  // handles transfer receipt at disbursement.
  if (action === "update" || action === "delete") {
    if (actor.role === "PETTY_CASH_CUSTODIAN") {
      return ALLOW("custodian manages replenishment memo");
    }
    return FINANCE_LIKE.includes(actor.role)
      ? ALLOW("finance manages disbursement proof")
      : DENY("only custodian / finance may manage replenishment docs");
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

/**
 * PM assignments (rules §7) — only OM/HM+ may assign a Project Manager to
 * a project. Matches the RLS policy `ppa_ops_write` in migration 0008.
 * Previously this decision allowed PROJECT_MANAGER too, which drifted
 * with RLS and would surface a raw 42501 to the user.
 */
function decidePmAssignment(actor: Actor, action: ActionVerb): Decision {
  if (action === "create" || action === "update" || action === "delete") {
    const canAssignPm: readonly EmployeeRole[] = [
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "TENANT_ADMIN",
    ];
    return canAssignPm.includes(actor.role)
      ? ALLOW("OM+ manages PM assignments")
      : DENY("only OM/HM+ may manage PM assignments");
  }
  return DENY(`unsupported action on PM assignment: ${action}`);
}

/**
 * Non-PM employee assignments (rules §7) — PM+ may assign employees to
 * projects. Matches RLS policy `pea_pm_write`.
 */
function decideEmployeeAssignment(actor: Actor, action: ActionVerb): Decision {
  if (action === "create" || action === "update" || action === "delete") {
    const canAssign: readonly EmployeeRole[] = [
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "TENANT_ADMIN",
    ];
    return canAssign.includes(actor.role)
      ? ALLOW("PM+ manages employee assignments")
      : DENY("only PM+ may manage employee assignments");
  }
  return DENY(`unsupported action on employee assignment: ${action}`);
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
// Base shift catalog (project_id IS NULL) — HR/OM tier only. These
// rows feed `shift_allowance` which lands in payroll (rules §14).
const SHIFT_BASE_WRITERS: readonly EmployeeRole[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
] as const;

// Project-scoped shift override writers — SPV/PM assigned to the
// project may customise time-of-day / labels for their site. The
// SQL trigger `work_shifts_guard_allowance` forces allowance to
// inherit from the base row so this cannot leak into payroll.
const SHIFT_PROJECT_WRITERS: readonly EmployeeRole[] = [
  ...SHIFT_BASE_WRITERS,
  "PROJECT_MANAGER",
  "SUPERVISOR",
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

function decideWorkShift(
  actor: Actor,
  action: ActionVerb,
  attrs: ResourceAttributes,
): Decision {
  if (action === "read") return ALLOW("shifts are tenant-wide reference");
  if (action === "create" || action === "update" || action === "delete") {
    // Base catalog: HR/OM tier only. Empty projectId means this is a
    // request against the tenant-wide catalog.
    if (!attrs.projectId) {
      return SHIFT_BASE_WRITERS.includes(actor.role)
        ? ALLOW("HR/OM tier edits base shift catalog")
        : DENY("only HR / OM tier may edit base shift catalog");
    }
    // Project-scoped: HR/OM always allowed. SPV/PM only if actively
    // assigned to the project. The RLS mirrors this check at the
    // database level as defense-in-depth.
    if (SHIFT_BASE_WRITERS.includes(actor.role)) {
      return ALLOW("HR/OM tier edits project shift override");
    }
    if (!SHIFT_PROJECT_WRITERS.includes(actor.role)) {
      return DENY("role may not edit shift catalog");
    }
    if (!attrs.isActiveAssignment) {
      return DENY("PM/SPV must be actively assigned to the project");
    }
    return ALLOW("assigned PM/SPV edits project shift override");
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

// ---------------------------------------------------------------------------
// Google Calendar sync (migration 0039). Admin surface for the outbox that
// pushes project + milestone changes to a tenant-owned Google Calendar.
// READ is visible to TENANT_ADMIN + GENERAL_MANAGER (matches the RLS policy
// `project_calendar_events_tenant_admin_read`). UPDATE covers retry-of-failed
// and force-reconcile buttons; DELETE is not exposed because rows carry
// meaningful audit history (attempt count, last_error) even after SKIP.
// ---------------------------------------------------------------------------
const CALENDAR_SYNC_ADMINS: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

function decideCalendarSync(actor: Actor, action: ActionVerb): Decision {
  const isAdmin = CALENDAR_SYNC_ADMINS.includes(actor.role);
  switch (action) {
    case "read":
      return isAdmin
        ? ALLOW("privileged role reads calendar sync outbox")
        : DENY("calendar sync dashboard restricted to admins + GM");
    case "update":
      return isAdmin
        ? ALLOW("privileged role may retry or skip outbox rows")
        : DENY("calendar sync mutations restricted to admins + GM");
    default:
      return DENY(`unsupported action on calendar_sync: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Tenant Telegram + WhatsApp integration config (rules §17).
//
// These resources gate the **tenant-level bot / sender credentials**, not
// the per-user chat linking (that surface lives in `/settings/preferences`
// and is protected by user-scoped RLS, no PDP entry needed).
//
// Only TENANT_ADMIN + GENERAL_MANAGER may create / update / delete these
// configs — mirrors the `secret_rotation` and `calendar_sync` policies.
// Read is *also* admin-only because the loader decrypts the bot token
// server-side; showing the row to a non-admin would leak the fact that a
// bot exists (side-channel not worth allowing).
// ---------------------------------------------------------------------------
const INTEGRATION_ADMIN_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

function decideTelegramBotConfig(
  actor: Actor,
  action: ActionVerb,
): Decision {
  const isAdmin = INTEGRATION_ADMIN_ROLES.includes(actor.role);
  switch (action) {
    case "read":
      return isAdmin
        ? ALLOW("admin/GM reads tenant telegram bot config")
        : DENY("telegram bot config restricted to admins + GM");
    case "create":
    case "update":
      return isAdmin
        ? ALLOW("admin/GM manages tenant telegram bot config")
        : DENY("telegram bot mutations restricted to admins + GM");
    case "delete":
      return isAdmin
        ? ALLOW("admin/GM may deactivate tenant telegram bot")
        : DENY("telegram bot deactivation restricted to admins + GM");
    default:
      return DENY(`unsupported action on telegram_bot_config: ${action}`);
  }
}

function decideWhatsAppConfig(actor: Actor, action: ActionVerb): Decision {
  const isAdmin = INTEGRATION_ADMIN_ROLES.includes(actor.role);
  switch (action) {
    case "read":
      return isAdmin
        ? ALLOW("admin/GM reads tenant whatsapp config")
        : DENY("whatsapp config restricted to admins + GM");
    case "create":
    case "update":
      return isAdmin
        ? ALLOW("admin/GM manages tenant whatsapp config")
        : DENY("whatsapp config mutations restricted to admins + GM");
    case "delete":
      return isAdmin
        ? ALLOW("admin/GM may deactivate tenant whatsapp config")
        : DENY("whatsapp deactivation restricted to admins + GM");
    default:
      return DENY(`unsupported action on whatsapp_config: ${action}`);
  }
}

function decideSmtpConfig(actor: Actor, action: ActionVerb): Decision {
  const isAdmin = INTEGRATION_ADMIN_ROLES.includes(actor.role);
  switch (action) {
    case "read":
      return isAdmin
        ? ALLOW("admin/GM reads tenant smtp config")
        : DENY("smtp config restricted to admins + GM");
    case "create":
    case "update":
      return isAdmin
        ? ALLOW("admin/GM manages tenant smtp config")
        : DENY("smtp config mutations restricted to admins + GM");
    case "delete":
      return isAdmin
        ? ALLOW("admin/GM may deactivate tenant smtp config")
        : DENY("smtp deactivation restricted to admins + GM");
    default:
      return DENY(`unsupported action on smtp_config: ${action}`);
  }
}

function decideAiConfig(actor: Actor, action: ActionVerb): Decision {
  const isAdmin = INTEGRATION_ADMIN_ROLES.includes(actor.role);
  switch (action) {
    case "read":
      return isAdmin
        ? ALLOW("admin/GM reads tenant ai config")
        : DENY("ai config restricted to admins + GM");
    case "create":
    case "update":
      return isAdmin
        ? ALLOW("admin/GM manages tenant ai config")
        : DENY("ai config mutations restricted to admins + GM");
    case "delete":
      return isAdmin
        ? ALLOW("admin/GM may deactivate tenant ai config")
        : DENY("ai deactivation restricted to admins + GM");
    default:
      return DENY(`unsupported action on ai_config: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Lookup options (migration 0049). Reference data (dropdown vocab) curated
// by admins. Read is public to every tenant member; create/update/delete
// restricted to TENANT_ADMIN + GENERAL_MANAGER — the same pair that
// governs `secret_rotation` and other admin-config surfaces.
// ---------------------------------------------------------------------------
const LOOKUP_OPTION_WRITERS: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

function decideLookupOption(actor: Actor, action: ActionVerb): Decision {
  const isWriter = LOOKUP_OPTION_WRITERS.includes(actor.role);
  switch (action) {
    case "read":
      return ALLOW("lookup options readable by any tenant member");
    case "create":
    case "update":
    case "delete":
      return isWriter
        ? ALLOW(`${actor.role} may curate lookup options`)
        : DENY("lookup option writes restricted to admins + GM");
    default:
      return DENY(`unsupported action on lookup_option: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// User admin surface (settings/users — migration 0052 Fase 2/3).
//
// Read      → TENANT_ADMIN + HR_ADMIN. Same set the RPC guards; keeps the
//             `authorize()` decision aligned with the DB-level filter.
// Create    → INVITE new user (send magic-link, insert employees row).
//             Only TENANT_ADMIN. HR_ADMIN's provisioning still runs through
//             the HR employees flow; keeping this narrow avoids two admins
//             fighting over the same auth.users record.
// Update    → CHANGE ROLE / SET STATUS. TENANT_ADMIN only.
// Delete    → FORCE LOGOUT (session invalidation). TENANT_ADMIN only.
//             We treat "delete" as a soft action — nothing is removed from
//             the DB, only Supabase sessions are revoked. Hard delete of
//             auth.users happens outside this app (retention rules §22).
// ---------------------------------------------------------------------------
const USER_ADMIN_READERS: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "HR_ADMIN",
];
const USER_ADMIN_WRITERS: readonly EmployeeRole[] = ["TENANT_ADMIN"];

function decideUserAdmin(actor: Actor, action: ActionVerb): Decision {
  const isReader = USER_ADMIN_READERS.includes(actor.role);
  const isWriter = USER_ADMIN_WRITERS.includes(actor.role);
  switch (action) {
    case "read":
      return isReader
        ? ALLOW(`${actor.role} may list users`)
        : DENY("user admin readable only by TENANT_ADMIN / HR_ADMIN");
    case "create":
    case "update":
    case "delete":
      return isWriter
        ? ALLOW(`${actor.role} may mutate user accounts`)
        : DENY("user admin mutations restricted to TENANT_ADMIN");
    default:
      return DENY(`unsupported action on user_admin: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Chart of Accounts (rules §16 — financial reference master).
//
// Reads: every tenant member (dropdowns everywhere) — handled in
// `allowReadWithinTenant`. Writes: TENANT_ADMIN (via the top-level admin
// override) + LEAD_FINANCE only. Finance owns the CoA in a service company
// context; delete is not exposed (accounts are deactivated instead).
// ---------------------------------------------------------------------------
const COA_WRITERS: readonly EmployeeRole[] = ["LEAD_FINANCE"];

function decideCoa(actor: Actor, action: ActionVerb): Decision {
  const isWriter = COA_WRITERS.includes(actor.role);
  switch (action) {
    case "create":
    case "update":
      return isWriter
        ? ALLOW(`${actor.role} may curate the chart of accounts`)
        : DENY("coa mutations restricted to TENANT_ADMIN / LEAD_FINANCE");
    case "delete":
      // Guard even for the admin override — CoA rows are soft-deactivated,
      // never removed, because `budget_details.coa_id` may still reference
      // them for historical accuracy.
      return DENY("coa rows must be deactivated, not deleted");
    default:
      return DENY(`unsupported action on coa: ${action}`);
  }
}

// ---------------------------------------------------------------------
// Performance evaluations — SPV/Team Lead drafts, PM reviews, OM decides
// (rules §6, §12 HR).
// ---------------------------------------------------------------------

/** Roles allowed to author / edit templates. Same as HR admin surface. */
const EVAL_TEMPLATE_WRITERS: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "HR_ADMIN",
];

function decideEvaluationTemplate(
  actor: Actor,
  action: ActionVerb,
): Decision {
  const isWriter = EVAL_TEMPLATE_WRITERS.includes(actor.role);
  switch (action) {
    case "read":
      return ALLOW("evaluation templates readable by any tenant member");
    case "create":
    case "update":
    case "delete":
      return isWriter
        ? ALLOW(`${actor.role} may manage evaluation templates`)
        : DENY(
            "evaluation template mutations restricted to HR / OM / HM / Admin",
          );
    default:
      return DENY(`unsupported action on evaluation_template: ${action}`);
  }
}

/**
 * Evaluation lifecycle guard. SPV/Team Lead can create + submit; PM
 * can review; OM decides. HR / Admin can manage everything.
 * Additional identity checks (is this SPV the one referenced on the
 * row?) happen inside the action handlers.
 */
function decideEvaluation(
  actor: Actor,
  action: ActionVerb,
  _attrs: ResourceAttributes,
): Decision {
  const isHrManagement =
    actor.role === "TENANT_ADMIN" ||
    actor.role === "HEAD_MANAGER" ||
    actor.role === "OPERATIONS_MANAGER" ||
    actor.role === "HR_ADMIN";
  const isSupervisor = actor.role === "SUPERVISOR";
  const isPm = actor.role === "PROJECT_MANAGER";

  switch (action) {
    case "read":
      // Read visibility is enforced further via RLS (SPV/PM/OM
      // referenced on the row or HR/Mgmt). PDP lets any staff try.
      return ALLOW("evaluation read gated by RLS");
    case "create":
    case "update":
      // Only SPV (as author), PM (adding review notes), OM (adding
      // decision notes), or HR/Mgmt.
      return isSupervisor || isPm || isHrManagement
        ? ALLOW(`${actor.role} may draft / edit evaluations`)
        : DENY(
            "evaluation drafts restricted to SPV / PM / OM / HR / Admin",
          );
    case "submit":
      return isSupervisor || isHrManagement
        ? ALLOW("SPV may submit evaluation")
        : DENY("submit restricted to SPV / HR / Admin");
    case "approve":
    case "reject":
      // Two-stage: PM review + OM final. Both allowed here; action
      // handler resolves which stage this call maps to based on the
      // row's current status.
      return isPm || isHrManagement
        ? ALLOW("PM / OM / HR may act on evaluation")
        : DENY("evaluation review restricted to PM / OM / HR / Admin");
    case "delete":
    case "cancel":
      return isHrManagement
        ? ALLOW("HR / Admin may cancel evaluations")
        : DENY("cancel restricted to HR / Admin");
    default:
      return DENY(`unsupported action on evaluation: ${action}`);
  }
}

/**
 * UPK note guard. Draft/edit: PM (usually) or HR/Mgmt. Finance
 * approves gate; Director for ≥ 50M. HR/Admin can override.
 */
function decideUpkNote(
  actor: Actor,
  action: ActionVerb,
  _attrs: ResourceAttributes,
): Decision {
  const isHrManagement =
    actor.role === "TENANT_ADMIN" ||
    actor.role === "HEAD_MANAGER" ||
    actor.role === "HR_ADMIN";
  const isFinance = actor.role === "LEAD_FINANCE";
  const isOm = actor.role === "OPERATIONS_MANAGER";
  const isPm = actor.role === "PROJECT_MANAGER";

  switch (action) {
    case "read":
      return ALLOW("upk read gated by RLS");
    case "create":
    case "update":
      return isPm || isOm || isHrManagement || isFinance
        ? ALLOW(`${actor.role} may draft UPK`)
        : DENY("UPK drafting restricted to PM / OM / Finance / HR / Admin");
    case "submit":
      return isPm || isOm || isHrManagement
        ? ALLOW("draft may be submitted to finance")
        : DENY("submit restricted to PM / OM / HR / Admin");
    case "approve":
    case "reject":
      return isFinance || isHrManagement || isOm
        ? ALLOW("finance / mgmt may decide UPK")
        : DENY("UPK decision restricted to Finance / HM / Admin");
    case "cancel":
      return isHrManagement
        ? ALLOW("HR / Admin may cancel UPK")
        : DENY("cancel restricted to HR / Admin");
    default:
      return DENY(`unsupported action on upk_note: ${action}`);
  }
}

/**
 * Knowledge base article guard.
 *
 * Policy summary (Fase 1 — Tier 1 KB, rules §17 + KM implementation
 * spec):
 *
 *   • read     — permissive within tenant; RLS filters draft
 *                visibility (author + admin only).
 *   • create   — any authenticated employee. Everyone in the
 *                organization is expected to contribute. Draft
 *                stays private via RLS until publish.
 *   • update   — author of the article OR admin/HR management.
 *                RLS is the failsafe; PDP is the intent.
 *   • submit   — reused as the "publish" verb (DRAFT → PUBLISHED).
 *                Any employee may publish their own drafts —
 *                intentional: forcing a moderation queue would kill
 *                velocity for what is effectively an internal wiki.
 *                A `moderate` verb + review workflow lands in Fase 3
 *                if abuse becomes measurable (rules §21 observability).
 *   • cancel   — reused as "archive" (PUBLISHED → ARCHIVED). Author
 *                OR admin.
 *   • delete   — never allowed. Archive is the user-facing removal;
 *                hard delete requires service-role escalation.
 *
 * `ownerEmployeeId` MUST be populated by the Server Action's
 * `resolveAttributes()` when the action is update / submit / cancel;
 * without it we treat the request as non-author and deny.
 */
function decideKnowledgeArticle(
  actor: Actor,
  action: ActionVerb,
  attrs: ResourceAttributes,
): Decision {
  // Delegates to `canManageKnowledgeArticles` — the single source of
  // truth for the KM admin gate (see rbac/roles.ts). Keeps this
  // function, the reader `canManage` check, and the RLS SELECT /
  // UPDATE policies aligned. `roleInGate` (via
  // canManageKnowledgeArticles) handles the legacy → canonical fold
  // so an actor seeded with the post-migration-0021 `ADMIN` value
  // still matches the legacy `TENANT_ADMIN` entry.
  const isAdmin = canManageKnowledgeArticles(actor.role);
  const isAuthor =
    attrs.ownerEmployeeId !== undefined &&
    attrs.ownerEmployeeId === actor.employeeId;

  switch (action) {
    case "read":
      return ALLOW("knowledge article read gated by RLS");
    case "create":
      return ALLOW("any employee may draft a knowledge article");
    case "update":
      return isAuthor || isAdmin
        ? ALLOW(
            isAuthor
              ? "author may edit their own article"
              : `${actor.role} may edit any article`,
          )
        : DENY("edit restricted to article author or admin");
    case "submit":
      return isAuthor || isAdmin
        ? ALLOW(
            isAuthor
              ? "author may publish their own draft"
              : `${actor.role} may publish any draft`,
          )
        : DENY("publish restricted to article author or admin");
    case "cancel":
      return isAuthor || isAdmin
        ? ALLOW(
            isAuthor
              ? "author may archive their own article"
              : `${actor.role} may archive any article`,
          )
        : DENY("archive restricted to article author or admin");
    case "delete":
      // Hard delete is service-role only. See migration 0095 header —
      // no RLS DELETE policy exists, so the Server Action layer must
      // not offer this verb.
      return DENY("knowledge_article hard-delete requires service role");
    default:
      return DENY(`unsupported action on knowledge_article: ${action}`);
  }
}

/**
 * Monthly report guard (rules §26). SPV drafts and submits; PM
 * approves. OM / HM / Admin can act as PM (broad-view override).
 * Later slices will extend this with client-portal + finance-facing
 * transitions.
 */
function decideMonthlyReport(
  actor: Actor,
  action: ActionVerb,
  _attrs: ResourceAttributes,
): Decision {
  const isSupervisor = actor.role === "SUPERVISOR";
  const isPm = actor.role === "PROJECT_MANAGER";
  const isFinance = actor.role === "LEAD_FINANCE";
  const isMgmt =
    actor.role === "TENANT_ADMIN" ||
    actor.role === "HEAD_MANAGER" ||
    actor.role === "OPERATIONS_MANAGER" ||
    actor.role === "GENERAL_MANAGER";

  switch (action) {
    case "read":
      // RLS narrows further to project members / submitters.
      return ALLOW("monthly report read gated by RLS");
    case "create":
    case "update":
      return isSupervisor || isPm || isMgmt
        ? ALLOW(`${actor.role} may draft / edit monthly report`)
        : DENY("monthly report drafts restricted to SPV / PM / OM / HM / Admin");
    case "submit":
      return isSupervisor || isPm || isMgmt
        ? ALLOW("SPV may submit monthly report")
        : DENY("submit restricted to SPV / PM / OM / HM / Admin");
    case "approve":
    case "reject":
      // Slice B adds finance-driven BA generation — LEAD_FINANCE can
      // trigger the BA when a PM is unavailable so billing doesn't
      // stall. RLS + the action's own status guard still enforce
      // scope (only APPROVED_BY_CLIENT rows can move to BA_GENERATED).
      return isPm || isMgmt || isFinance
        ? ALLOW("PM / mgmt / finance may act on monthly report")
        : DENY(
            "review restricted to PM / OM / HM / Admin / Lead Finance",
          );
    case "cancel":
      return isMgmt
        ? ALLOW("mgmt may cancel monthly report")
        : DENY("cancel restricted to management");
    default:
      return DENY(`unsupported action on monthly_report: ${action}`);
  }
}

/**
 * Reports module guard. Reports are pure `read` operations layered on
 * top of the tables they aggregate — RLS handles the actual data
 * scoping. This helper answers the coarse question "may this role run
 * *any* report?" so the `/reports` route + download API can fail fast
 * before touching the DB. Per-report visibility (which cards appear)
 * is enforced separately via `reportsForRole()` in
 * `src/lib/reports/registry.ts`.
 */
const REPORT_RUNNERS: readonly EmployeeRole[] = [
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "LEAD_FINANCE",
  "HR_ADMIN",
  "TENANT_ADMIN",
  "PETTY_CASH_CUSTODIAN",
];

function decideReport(actor: Actor, action: ActionVerb): Decision {
  if (action !== "read") {
    return DENY(`unsupported action on report: ${action}`);
  }
  return REPORT_RUNNERS.includes(actor.role)
    ? ALLOW(`${actor.role} may run reports`)
    : DENY("reports restricted to PM+ / Finance / Custodian tiers");
}

// ---------------------------------------------------------------------------
// Bulk import (rules §17 + §22).
// ---------------------------------------------------------------------------
// Bulk import is a privileged mutation surface that can create hundreds
// of rows in a single click. Restricted to master-data owners:
//   - HR_ADMIN         — Employees master
//   - LEAD_FINANCE     — Budget lines / COA-adjacent data
//   - TENANT_ADMIN     — Everything (tenant setup)
//   - OM / HM / GM     — Portfolio-level onboarding
// PROJECT_MANAGER can't bulk import employees/budgets by design — that
// would concentrate too much cost authority in one role (rules §6).
const BULK_IMPORT_ROLES: readonly EmployeeRole[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "LEAD_FINANCE",
];

function decideImportJob(actor: Actor, action: ActionVerb): Decision {
  // Read: same allow-list — you can't inspect other people's imports
  // if you can't run one yourself. Prevents lateral audit exposure.
  if (action === "read") {
    return BULK_IMPORT_ROLES.includes(actor.role)
      ? ALLOW("import history visible to master-data owners")
      : DENY("bulk import history restricted to master-data owners");
  }
  if (action === "bulk_import" || action === "create") {
    return BULK_IMPORT_ROLES.includes(actor.role)
      ? ALLOW("role may execute bulk import")
      : DENY("bulk import restricted to HR / Finance / Admin tier");
  }
  return DENY(`unsupported action on import_job: ${action}`);
}
