import type {
  EmployeeAvailabilityInput,
  EmploymentTypeInput,
} from "@/lib/validation/employee";

/**
 * ControlDesk HR directory — phase-1 suggestion lists.
 *
 * These constants live in code (not the DB) because HR usage patterns tend
 * to stabilise fast in a BPO context. Once departments / positions become
 * strategic (headcount planning, per-department SLA reports, per-position
 * salary bands) they should be promoted to `hr_departments` + `hr_positions`
 * tables. For phase-1 we keep them as free-text with a Combobox suggestion
 * list so the DB doesn't get in the way of onboarding.
 */

export const DEFAULT_DEPARTMENTS: readonly string[] = [
  "Operations",
  "Project Delivery",
  "Finance",
  "Human Resources",
  "IT & Infrastructure",
  "Sales & Marketing",
  "Client Success",
];

export const DEFAULT_POSITIONS: readonly string[] = [
  "Agent",
  "Team Lead",
  "Supervisor",
  "Analyst",
  "Senior Analyst",
  "Manager",
  "Head of Department",
  "Director",
  "Specialist",
];

/**
 * Days of runway before an expiring contract triggers a reminder for HR.
 * The sweeper cron re-notifies at each threshold so HR sees the ramp.
 */
export const CONTRACT_EXPIRY_THRESHOLDS_DAYS = [30, 14, 7, 1] as const;

// ---------------------------------------------------------------------------
// Tone helpers for badges — kept alongside enum for a single source of truth.
// ---------------------------------------------------------------------------
export const EMPLOYMENT_TYPE_TONE: Record<EmploymentTypeInput, string> = {
  PERMANENT: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  CONTRACT: "border-indigo-500/30 bg-indigo-500/10 text-indigo-500",
  PROBATION: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  INTERN: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  OUTSOURCE: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-500",
  OUTTASK: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

export const AVAILABILITY_TONE: Record<EmployeeAvailabilityInput, string> = {
  AVAILABLE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  ASSIGNED: "border-indigo-500/30 bg-indigo-500/10 text-indigo-500",
  ON_LEAVE: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  INACTIVE: "border-white/10 bg-white/5 text-muted-foreground",
};
