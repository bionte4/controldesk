/**
 * ControlDesk daily digest builder (rules §20).
 *
 * Pure functions that turn raw query results into structured `DigestBundle`s
 * plus render helpers (subject + text + HTML). The route handler is thin —
 * it queries data, hands it to `buildDigest`, and dispatches the emails.
 *
 * Tests exercise the builder directly with fabricated rows.
 */

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

export function renderDigestText(bundle: DigestBundle): string {
  const parts: string[] = [];
  const greeting =
    bundle.role_audience === "HR_ADMIN"
      ? LABEL_ID.greetingHr
      : bundle.role_audience === "LEAD_FINANCE"
        ? LABEL_ID.greetingFinance
        : LABEL_ID.greetingOps;
  parts.push(greeting, "");

  parts.push(`## ${LABEL_ID.sectionPending}`);
  if (bundle.pending_approvals.length === 0) {
    parts.push(LABEL_ID.none);
  } else {
    for (const a of bundle.pending_approvals) {
      parts.push(`  • ${LABEL_ID.approvalRow(a)}`);
    }
  }
  parts.push("");

  parts.push(`## ${LABEL_ID.sectionLowFund}`);
  if (bundle.petty_cash_low_funds.length === 0) {
    parts.push(LABEL_ID.none);
  } else {
    for (const f of bundle.petty_cash_low_funds) {
      parts.push(`  • ${LABEL_ID.lowFundRow(f)}`);
    }
  }
  parts.push("");

  parts.push(`## ${LABEL_ID.sectionSla}`);
  if (bundle.sla_breach_risks.length === 0) {
    parts.push(LABEL_ID.none);
  } else {
    for (const s of bundle.sla_breach_risks) {
      parts.push(`  • ${LABEL_ID.slaRow(s)}`);
    }
  }
  parts.push("", LABEL_ID.footer);
  return parts.join("\n");
}

export function renderDigestHtml(bundle: DigestBundle): string {
  const section = (title: string, rows: string[]) => `
    <h2 style="font-size:14px;margin:24px 0 8px;color:#0f172a">${escapeHtml(title)}</h2>
    ${
      rows.length === 0
        ? `<p style="color:#64748b;font-size:13px">${escapeHtml(LABEL_ID.none)}</p>`
        : `<ul style="padding-left:18px;color:#0f172a;font-size:13px;line-height:1.6">${rows
            .map((r) => `<li>${escapeHtml(r)}</li>`)
            .join("")}</ul>`
    }
  `;

  const greeting =
    bundle.role_audience === "HR_ADMIN"
      ? LABEL_ID.greetingHr
      : bundle.role_audience === "LEAD_FINANCE"
        ? LABEL_ID.greetingFinance
        : LABEL_ID.greetingOps;

  return `<!doctype html>
<html lang="id"><body style="margin:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,'Segoe UI',sans-serif">
  <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:16px;padding:28px;box-shadow:0 4px 24px rgba(15,23,42,0.06)">
    <p style="color:#334155;font-size:13px;margin:0 0 4px;letter-spacing:0.06em;text-transform:uppercase">${escapeHtml(bundle.tenant_name)}</p>
    <h1 style="font-size:20px;margin:0 0 16px;color:#0f172a">${escapeHtml(LABEL_ID.subject(bundle.tenant_name))}</h1>
    <p style="color:#0f172a;font-size:14px;margin:0 0 12px">${escapeHtml(greeting)}</p>
    ${section(
      LABEL_ID.sectionPending,
      bundle.pending_approvals.map((a) => LABEL_ID.approvalRow(a)),
    )}
    ${section(
      LABEL_ID.sectionLowFund,
      bundle.petty_cash_low_funds.map((f) => LABEL_ID.lowFundRow(f)),
    )}
    ${section(
      LABEL_ID.sectionSla,
      bundle.sla_breach_risks.map((s) => LABEL_ID.slaRow(s)),
    )}
    <p style="color:#94a3b8;font-size:11px;margin-top:24px">${escapeHtml(LABEL_ID.footer)}</p>
  </div>
</body></html>`;
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
