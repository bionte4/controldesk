/**
 * ControlDesk RBAC — rules §4 hierarchy + §7 dynamic approval thresholds.
 *
 * The enum here mirrors the `public.employee_role` Postgres enum from
 * `supabase/migrations/0002_tenants_and_auth.sql`. Keep them in sync — the
 * DB is the source of truth; this file just gives TypeScript ergonomics.
 */

export const EMPLOYEE_ROLES = [
  "EMPLOYEE",
  "SUPERVISOR",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "PETTY_CASH_CUSTODIAN",
  "LEAD_FINANCE",
  "HR_ADMIN",
  "TENANT_ADMIN",
] as const;

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

/**
 * Operational chain of command (rules §4). Higher rank ⇒ approves higher
 * spend brackets. Staff / functional roles (finance, HR, custodian) are
 * intentionally NOT in this ladder — they are gatekeepers, not escalation
 * targets. Use `isStaffRole()` / `canApproveThreshold()` for those flows.
 */
export const OPERATIONAL_LADDER: readonly EmployeeRole[] = [
  "EMPLOYEE",
  "SUPERVISOR",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
] as const;

export const STAFF_ROLES: readonly EmployeeRole[] = [
  "PETTY_CASH_CUSTODIAN",
  "LEAD_FINANCE",
  "HR_ADMIN",
] as const;

/**
 * Numeric rank on the operational ladder. Returns -1 for staff/functional
 * roles (finance, HR, custodian) which live outside the chain.
 */
export function roleRank(role: EmployeeRole): number {
  return OPERATIONAL_LADDER.indexOf(role);
}

export function isStaffRole(role: EmployeeRole): boolean {
  return STAFF_ROLES.includes(role);
}

export function isOperationalRole(role: EmployeeRole): boolean {
  return roleRank(role) >= 0;
}

/**
 * Rules §7 Threshold Matrix (IDR):
 *   <  Rp     5.000.000  → L2 PM  + Finance
 *   ≤  Rp    25.000.000  → L3 OM  + Finance
 *   ≤  Rp   100.000.000  → L4 HM  + Finance
 *   >  Rp   100.000.000  → L5 GM  + Finance
 *
 * Every bracket also requires LEAD_FINANCE at the parallel gate.
 */
export const APPROVAL_THRESHOLDS_IDR = {
  L1_SUPERVISOR: 0,
  L2_PROJECT_MANAGER: 5_000_000,
  L3_OPERATIONS_MANAGER: 25_000_000,
  L4_HEAD_MANAGER: 100_000_000,
  L5_GENERAL_MANAGER: Number.POSITIVE_INFINITY,
} as const;

export type ApprovalLevel = keyof typeof APPROVAL_THRESHOLDS_IDR;

/**
 * Returns the highest operational level required to approve `amountIDR`.
 * The Lead Finance gate is always required in parallel — callers should
 * enforce that separately (`requiresFinanceApproval(amountIDR) === true`).
 */
export function requiredApprovalChain(amountIDR: number): ApprovalLevel[] {
  const chain: ApprovalLevel[] = ["L1_SUPERVISOR", "L2_PROJECT_MANAGER"];
  if (amountIDR > APPROVAL_THRESHOLDS_IDR.L2_PROJECT_MANAGER) chain.push("L3_OPERATIONS_MANAGER");
  if (amountIDR > APPROVAL_THRESHOLDS_IDR.L3_OPERATIONS_MANAGER) chain.push("L4_HEAD_MANAGER");
  if (amountIDR > APPROVAL_THRESHOLDS_IDR.L4_HEAD_MANAGER) chain.push("L5_GENERAL_MANAGER");
  return chain;
}

/**
 * Rules §7 — Lead Finance always participates. Kept as a named predicate so
 * callers read like the business spec.
 */
export function requiresFinanceApproval(_amountIDR: number): boolean {
  return true;
}

const APPROVAL_LEVEL_TO_ROLE: Record<ApprovalLevel, EmployeeRole> = {
  L1_SUPERVISOR: "SUPERVISOR",
  L2_PROJECT_MANAGER: "PROJECT_MANAGER",
  L3_OPERATIONS_MANAGER: "OPERATIONS_MANAGER",
  L4_HEAD_MANAGER: "HEAD_MANAGER",
  L5_GENERAL_MANAGER: "GENERAL_MANAGER",
};

/**
 * True if the given operational role is authorized to approve `amountIDR`
 * on the operational chain (i.e. its rank is ≥ the terminal level required
 * for that amount). TENANT_ADMIN short-circuits to true.
 */
export function canApproveThreshold(role: EmployeeRole, amountIDR: number): boolean {
  if (role === "TENANT_ADMIN") return true;
  const chain = requiredApprovalChain(amountIDR);
  const terminalRole = APPROVAL_LEVEL_TO_ROLE[chain[chain.length - 1]!];
  return roleRank(role) >= roleRank(terminalRole);
}

/**
 * Human-friendly role labels for the UI. Kept as a plain object so it is
 * tree-shakable and easy to i18n later.
 */
export const ROLE_LABELS: Record<EmployeeRole, string> = {
  EMPLOYEE: "Employee",
  SUPERVISOR: "Supervisor",
  PROJECT_MANAGER: "Project Manager",
  OPERATIONS_MANAGER: "Operations Manager",
  HEAD_MANAGER: "Head Manager",
  GENERAL_MANAGER: "General Manager",
  PETTY_CASH_CUSTODIAN: "Petty Cash Custodian",
  LEAD_FINANCE: "Lead Finance",
  HR_ADMIN: "HR Admin",
  TENANT_ADMIN: "Tenant Admin",
};

export function formatRole(role: AnyDbEmployeeRole): string {
  if (role in ROLE_LABELS) {
    return ROLE_LABELS[role as EmployeeRole];
  }
  // Canonical value — fall back to the canonical labels defined below.
  return CANONICAL_ROLE_LABELS[role as CanonicalRole] ?? String(role);
}

// ---------------------------------------------------------------------------
// GAS-ALIGNED CANONICAL ROLE MODEL (Fase 0 — rules §6 rewrite).
//
// The GAS ERP at `bontiharyanto/erp-system` collapses the BPO 10-role
// hierarchy into 7 role codes plus one external portal role. New code MUST
// use `CanonicalRole` and the GAS-aligned threshold helpers below; the
// legacy 10-role model (above) is kept only so `pdp.ts` and older RLS
// policies continue to compile during the Fase 0 rollout.
//
// A DB-level enum swap will land in migration `0021_gas_alignment_roles.sql`
// (Fase 0.2). Until then, the Postgres `employee_role` enum keeps its 10
// legacy values and the mapping in `toCanonicalRole()` converts on read.
// ---------------------------------------------------------------------------

export const CANONICAL_ROLES = [
  "EMPLOYEE",
  "SUPERVISOR",
  "PM",
  "OM",
  "FINANCE",
  "DIRECTOR",
  "ADMIN",
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

/** External portal role — lives in `client_users`, NOT in `employees`. */
export const PORTAL_ROLE = "CLIENT" as const;
export type PortalRole = typeof PORTAL_ROLE;

/**
 * Union of every valid string that may appear in `employees.role` — the 10
 * legacy BPO codes PLUS the 5 canonical codes seeded from migration 0021.
 * The DB accepts both; TypeScript needs to accept both too so RSC code that
 * reads a row via supabase-js can hand the raw value to `toCanonicalRole()`
 * without a cast.
 */
export type AnyDbEmployeeRole = EmployeeRole | CanonicalRole;

/**
 * Map any DB `employee_role` value onto its canonical GAS role.
 *
 * Fold rules (legacy 10 → canonical 7):
 *   TENANT_ADMIN + HR_ADMIN                 → ADMIN
 *   GENERAL_MANAGER + HEAD_MANAGER          → DIRECTOR
 *   LEAD_FINANCE + PETTY_CASH_CUSTODIAN     → FINANCE
 *   OPERATIONS_MANAGER                      → OM
 *   PROJECT_MANAGER                         → PM
 *   SUPERVISOR + EMPLOYEE                   → unchanged
 *
 * Canonical passthroughs (already in the target space):
 *   ADMIN, DIRECTOR, FINANCE, PM, OM        → returned as-is
 */
export function toCanonicalRole(dbRole: AnyDbEmployeeRole): CanonicalRole {
  switch (dbRole) {
    case "TENANT_ADMIN":
    case "HR_ADMIN":
    case "ADMIN":
      return "ADMIN";
    case "GENERAL_MANAGER":
    case "HEAD_MANAGER":
    case "DIRECTOR":
      return "DIRECTOR";
    case "LEAD_FINANCE":
    case "PETTY_CASH_CUSTODIAN":
    case "FINANCE":
      return "FINANCE";
    case "OPERATIONS_MANAGER":
    case "OM":
      return "OM";
    case "PROJECT_MANAGER":
    case "PM":
      return "PM";
    case "SUPERVISOR":
      return "SUPERVISOR";
    case "EMPLOYEE":
      return "EMPLOYEE";
  }
}

/**
 * Reverse map used by seed / test factories that want to produce a legacy
 * DB row from a canonical role. `ADMIN → TENANT_ADMIN`, `DIRECTOR → GENERAL_MANAGER`,
 * `FINANCE → LEAD_FINANCE`, etc. Kept deterministic so E2E fixtures are stable.
 */
export function toLegacyDbRole(canonical: CanonicalRole): EmployeeRole {
  switch (canonical) {
    case "ADMIN":
      return "TENANT_ADMIN";
    case "DIRECTOR":
      return "GENERAL_MANAGER";
    case "FINANCE":
      return "LEAD_FINANCE";
    case "OM":
      return "OPERATIONS_MANAGER";
    case "PM":
      return "PROJECT_MANAGER";
    case "SUPERVISOR":
      return "SUPERVISOR";
    case "EMPLOYEE":
      return "EMPLOYEE";
  }
}

/**
 * GAS ERP `Config.APPROVAL` — value thresholds (in IDR) that drive the
 * 3-tier chain in §9. Kept as a frozen object so PDP + tests + UI hint
 * banners read from one source of truth. Tunable per-tenant via table
 * `approval_thresholds` (planned Fase 0 migration §26).
 */
export const APPROVAL_CONFIG = Object.freeze({
  EXPENSE: {
    PM_THRESHOLD: 5_000_000,
    DIRECTOR_THRESHOLD: 50_000_000,
  },
  BUDGET: {
    DIRECTOR_THRESHOLD: 50_000_000,
  },
  CASH_ADVANCE_GENERAL: {
    PM_THRESHOLD: 2_000_000,
    DIRECTOR_THRESHOLD: 20_000_000,
  },
  CASH_ADVANCE_FIELD_OPS: {
    PM_THRESHOLD: 5_000_000,
    OM_THRESHOLD: 20_000_000,
    DIRECTOR_THRESHOLD: 50_000_000,
    SETTLEMENT_SLA_DAYS: 10,
    SETTLEMENT_REMINDER_OFFSETS: [-3, 0, 1, 3, 7] as const,
  },
  PETTY_CASH: {
    AUTO_APPROVE_BELOW: 200_000,
    RECEIPT_REQUIRED_ABOVE: 100_000,
    HARD_CEILING: 2_000_000,
    LOW_BALANCE_RATIO: 0.2,
    RECON_OVERDUE_DAYS: 3,
    VARIANCE_TOLERANCE_IDR: 5_000,
  },
  BUDGET_REQUEST: {
    PM_THRESHOLD: 5_000_000,
    DIRECTOR_THRESHOLD: 50_000_000,
    MIN_JUSTIFICATION_CHARS: 15,
    MAX_JUSTIFICATION_CHARS: 2000,
  },
} as const);

/**
 * Canonical approval slots. `FINANCE` is a parallel gate (always present)
 * rather than an ordinal rank — callers should treat it as its own axis.
 */
export type CanonicalApprovalSlot = "PM" | "OM" | "FINANCE" | "DIRECTOR" | "SUPERVISOR";

/**
 * Chain for a plain `Expense` (rules §9.1).
 *   <  5M           → [FINANCE]
 *   ≥  5M, < 50M    → [PM, FINANCE]
 *   ≥ 50M           → [PM, FINANCE, DIRECTOR]
 */
export function expenseApprovalChain(amountIDR: number): CanonicalApprovalSlot[] {
  const { PM_THRESHOLD, DIRECTOR_THRESHOLD } = APPROVAL_CONFIG.EXPENSE;
  const chain: CanonicalApprovalSlot[] = [];
  if (amountIDR >= PM_THRESHOLD) chain.push("PM");
  chain.push("FINANCE");
  if (amountIDR >= DIRECTOR_THRESHOLD) chain.push("DIRECTOR");
  return chain;
}

/** Chain for a `Budget` submission (rules §9.2). */
export function budgetApprovalChain(totalPlannedIDR: number): CanonicalApprovalSlot[] {
  const chain: CanonicalApprovalSlot[] = ["FINANCE"];
  if (totalPlannedIDR >= APPROVAL_CONFIG.BUDGET.DIRECTOR_THRESHOLD) chain.push("DIRECTOR");
  return chain;
}

/** Chain for Cash Advance `type='General'` (rules §9.3). */
export function caGeneralApprovalChain(amountIDR: number): CanonicalApprovalSlot[] {
  const { PM_THRESHOLD, DIRECTOR_THRESHOLD } = APPROVAL_CONFIG.CASH_ADVANCE_GENERAL;
  const chain: CanonicalApprovalSlot[] = [];
  if (amountIDR >= PM_THRESHOLD) chain.push("PM");
  chain.push("FINANCE");
  if (amountIDR >= DIRECTOR_THRESHOLD) chain.push("DIRECTOR");
  return chain;
}

/**
 * Chain for Cash Advance `type='FieldOps'` (rules §9.4 / §27). Supervisor
 * always at rung 0 because field visits are Supervisor-initiated by design.
 */
export function caFieldOpsApprovalChain(amountIDR: number): CanonicalApprovalSlot[] {
  const { PM_THRESHOLD, OM_THRESHOLD, DIRECTOR_THRESHOLD } =
    APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS;
  const chain: CanonicalApprovalSlot[] = ["SUPERVISOR"];
  if (amountIDR >= PM_THRESHOLD) chain.push("PM");
  if (amountIDR >= OM_THRESHOLD) chain.push("OM");
  chain.push("FINANCE");
  if (amountIDR >= DIRECTOR_THRESHOLD) chain.push("DIRECTOR");
  return chain;
}

/** Chain for a Budget Request Increase/Decrease/Transfer (rules §9.6). */
export function budgetRequestApprovalChain(amountIDR: number): CanonicalApprovalSlot[] {
  const { PM_THRESHOLD, DIRECTOR_THRESHOLD } = APPROVAL_CONFIG.BUDGET_REQUEST;
  const chain: CanonicalApprovalSlot[] = [];
  if (amountIDR >= PM_THRESHOLD) chain.push("PM");
  chain.push("FINANCE");
  if (amountIDR >= DIRECTOR_THRESHOLD) chain.push("DIRECTOR");
  return chain;
}

/**
 * Petty cash decision — returned as a discriminated union so callers don't
 * need a second lookup to know whether the entry auto-posts.
 */
export type PettyCashDecision =
  | { kind: "AUTO_APPROVE" }
  | { kind: "FINANCE_APPROVAL_REQUIRED"; requiresReceipt: boolean }
  | { kind: "ABOVE_CEILING"; useExpenseFlowInstead: true };

export function pettyCashDecision(amountIDR: number): PettyCashDecision {
  const { AUTO_APPROVE_BELOW, RECEIPT_REQUIRED_ABOVE, HARD_CEILING } =
    APPROVAL_CONFIG.PETTY_CASH;
  if (amountIDR > HARD_CEILING) {
    return { kind: "ABOVE_CEILING", useExpenseFlowInstead: true };
  }
  if (amountIDR < AUTO_APPROVE_BELOW) {
    return { kind: "AUTO_APPROVE" };
  }
  return {
    kind: "FINANCE_APPROVAL_REQUIRED",
    requiresReceipt: amountIDR >= RECEIPT_REQUIRED_ABOVE,
  };
}

/**
 * True if the given canonical role can decide on `slot`.
 *   - `FINANCE` slot: FINANCE + ADMIN.
 *   - `PM` slot: PM + OM + DIRECTOR + ADMIN.
 *   - `OM` slot: OM + DIRECTOR + ADMIN.
 *   - `DIRECTOR` slot: DIRECTOR + ADMIN.
 *   - `SUPERVISOR` slot: SUPERVISOR + PM + OM + DIRECTOR + ADMIN.
 *
 * Higher-rank canonicals are allowed to short-circuit lower slots (matches
 * GAS `ScopeService.canApprove` — a Director can always sign off in place
 * of a Manager). Audit still records who acted.
 */
export function canonicalCanApprove(
  actor: CanonicalRole,
  slot: CanonicalApprovalSlot,
): boolean {
  if (actor === "ADMIN") return true;
  switch (slot) {
    case "SUPERVISOR":
      return ["SUPERVISOR", "PM", "OM", "DIRECTOR"].includes(actor);
    case "PM":
      return ["PM", "OM", "DIRECTOR"].includes(actor);
    case "OM":
      return ["OM", "DIRECTOR"].includes(actor);
    case "FINANCE":
      return actor === "FINANCE";
    case "DIRECTOR":
      return actor === "DIRECTOR";
  }
}

/**
 * GAS `Config.MULTI_PROJECT_ROLES`. Employees with these roles are allowed
 * to hold ACTIVE assignments on more than one project simultaneously
 * without triggering the SINGLE_PROJECT_VIOLATION warning. Everyone else
 * is expected to be on a single project at a time; overrides possible
 * but require a written note on the assignment.
 */
export const MULTI_PROJECT_CANONICAL_ROLES: readonly CanonicalRole[] = [
  "PM",
  "OM",
] as const;

/** Human-friendly canonical role labels for UI/badges. */
export const CANONICAL_ROLE_LABELS: Record<CanonicalRole, string> = {
  EMPLOYEE: "Employee",
  SUPERVISOR: "Supervisor",
  PM: "Project Manager",
  OM: "Operations Manager",
  FINANCE: "Finance",
  DIRECTOR: "Director",
  ADMIN: "Administrator",
};
