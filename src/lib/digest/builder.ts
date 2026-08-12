/**
 * ControlDesk daily digest builder (rules §20).
 *
 * Pure functions that turn raw query results into structured `DigestBundle`s
 * plus render helpers (subject + text + HTML). The route handler is thin —
 * it queries data, hands it to `buildDigest`, and dispatches the emails.
 *
 * Tests exercise the builder directly with fabricated rows.
 *
 * Rendering is delegated to the shared `src/lib/notify/templates/skeleton.ts`
 * so digest emails share the same visual identity (card + eyebrow + footer)
 * as signup / reminder emails. If you touch the visual layout, update the
 * skeleton — not this file.
 */

import {
  renderEmailBody,
  type EmailSection,
} from "@/lib/notify/templates/skeleton";

export type Locale = "id-ID" | "en-US";

export type PendingApproval = {
  id: string;
  kind: "EXPENSE" | "CASH_ADVANCE" | "HR_REQUEST" | "PETTY_CASH_REPLENISHMENT";
  reference: string;
  amount_idr?: number;
  submitted_by: string;
  submitted_at: string; // ISO
  hours_pending: number;
  action_url?: string;
};

export type PettyCashLowFund = {
  fund_name: string;
  location: string | null;
  balance_idr: number;
  min_threshold_idr: number;
  action_url?: string;
};

export type SlaBreachRisk = {
  project_code: string;
  breach_within_hours: number;
  breach_probability: number; // 0..1
  contributing_factors: readonly string[];
};

export type DigestBundle = {
  tenant_id: string;
  tenant_name: string;
  role_audience: "HR_ADMIN" | "LEAD_FINANCE" | "OPERATIONS";
  generated_at: string;
  pending_approvals: PendingApproval[];
  petty_cash_low_funds: PettyCashLowFund[];
  sla_breach_risks: SlaBreachRisk[];
};

export type DigestRecipient = {
  employee_id: string;
  full_name: string;
  email: string;
  audience: DigestBundle["role_audience"];
};

// ---------------------------------------------------------------------------
// Filters — decide which items belong in a bundle for a given audience.
// ---------------------------------------------------------------------------
export const APPROVAL_AGE_THRESHOLD_HOURS = 24;
export const PETTY_CASH_LOW_RATIO = 1.0; // balance < min_threshold triggers

export function filterApprovalsForAudience(
  approvals: readonly PendingApproval[],
  audience: DigestBundle["role_audience"],
): PendingApproval[] {
  return approvals.filter((a) => {
    if (a.hours_pending < APPROVAL_AGE_THRESHOLD_HOURS) return false;
    if (audience === "HR_ADMIN") return a.kind === "HR_REQUEST";
    if (audience === "LEAD_FINANCE") {
      return (
        a.kind === "EXPENSE" ||
        a.kind === "CASH_ADVANCE" ||
        a.kind === "PETTY_CASH_REPLENISHMENT"
      );
    }
    return true; // OPERATIONS gets everything
  });
}

export function shouldSendDigest(bundle: DigestBundle): boolean {
  return (
    bundle.pending_approvals.length > 0 ||
    bundle.petty_cash_low_funds.length > 0 ||
    bundle.sla_breach_risks.length > 0
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const LABEL_ID = {
  subject: (tenantName: string) =>
    `ControlDesk — Ringkasan harian (${tenantName})`,
  greetingHr: "Halo tim HR,",
  greetingFinance: "Halo tim Finance,",
  greetingOps: "Halo tim Ops,",
  sectionPending: "Approval menunggu >24 jam",
  sectionLowFund: "Kas kecil mendekati minimum",
  sectionSla: "Risiko pelanggaran SLA (24–48 jam ke depan)",
  none: "Tidak ada item bertanda merah.",
  footer:
    "Email ini otomatis dikirim ControlDesk. Klik tautan untuk membuka detail approval.",
  approvalRow: (a: PendingApproval) =>
    `[${a.kind}] ${a.reference} · ${a.submitted_by} · ${a.hours_pending.toFixed(0)}j`,
  lowFundRow: (f: PettyCashLowFund) =>
    `${f.fund_name}${f.location ? ` (${f.location})` : ""}: saldo ${formatIdr(
      f.balance_idr,
    )} < minimum ${formatIdr(f.min_threshold_idr)}`,
  slaRow: (s: SlaBreachRisk) =>
    `${s.project_code}: risiko ${(s.breach_probability * 100).toFixed(0)}% dalam ${s.breach_within_hours.toFixed(
      0,
    )}j — ${s.contributing_factors.join(", ")}`,
} as const;

export function renderDigestSubject(bundle: DigestBundle, _locale: Locale = "id-ID"): string {
  void _locale;
  return LABEL_ID.subject(bundle.tenant_name);
}

function buildDigestSections(bundle: DigestBundle): EmailSection[] {
  return [
    {
      heading: LABEL_ID.sectionPending,
      body:
        bundle.pending_approvals.length === 0 ? LABEL_ID.none : undefined,
      items:
        bundle.pending_approvals.length > 0
          ? bundle.pending_approvals.map((a) => LABEL_ID.approvalRow(a))
          : undefined,
    },
    {
      heading: LABEL_ID.sectionLowFund,
      body:
        bundle.petty_cash_low_funds.length === 0 ? LABEL_ID.none : undefined,
      items:
        bundle.petty_cash_low_funds.length > 0
          ? bundle.petty_cash_low_funds.map((f) => LABEL_ID.lowFundRow(f))
          : undefined,
    },
    {
      heading: LABEL_ID.sectionSla,
      body:
        bundle.sla_breach_risks.length === 0 ? LABEL_ID.none : undefined,
      items:
        bundle.sla_breach_risks.length > 0
          ? bundle.sla_breach_risks.map((s) => LABEL_ID.slaRow(s))
          : undefined,
    },
  ];
}

function greetingFor(bundle: DigestBundle): string {
  return bundle.role_audience === "HR_ADMIN"
    ? LABEL_ID.greetingHr
    : bundle.role_audience === "LEAD_FINANCE"
      ? LABEL_ID.greetingFinance
      : LABEL_ID.greetingOps;
}

export function renderDigestText(bundle: DigestBundle): string {
  return renderEmailBody({
    tenantName: bundle.tenant_name,
    title: LABEL_ID.subject(bundle.tenant_name),
    greeting: greetingFor(bundle),
    sections: buildDigestSections(bundle),
    footerNote: LABEL_ID.footer,
  }).text;
}

export function renderDigestHtml(bundle: DigestBundle): string {
  return renderEmailBody({
    tenantName: bundle.tenant_name,
    title: LABEL_ID.subject(bundle.tenant_name),
    greeting: greetingFor(bundle),
    sections: buildDigestSections(bundle),
    footerNote: LABEL_ID.footer,
  }).html;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function computeHoursPending(submittedAt: string, now: Date): number {
  const submitted = new Date(submittedAt).getTime();
  if (Number.isNaN(submitted)) return 0;
  return (now.getTime() - submitted) / 3_600_000;
}

function formatIdr(idr: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(idr);
}
