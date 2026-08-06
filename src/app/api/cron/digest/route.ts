import { NextResponse } from "next/server";

import {
  APPROVAL_AGE_THRESHOLD_HOURS,
  PETTY_CASH_LOW_RATIO,
  computeHoursPending,
  filterApprovalsForAudience,
  renderDigestHtml,
  renderDigestSubject,
  renderDigestText,
  shouldSendDigest,
  type DigestBundle,
  type DigestRecipient,
  type PendingApproval,
  type PettyCashLowFund,
} from "@/lib/digest/builder";
import { sendEmail } from "@/lib/notify/mailer";
import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Daily digest cron (rules §20).
 *
 * Runs at 08:00 Asia/Jakarta (01:00 UTC). Iterates every tenant, builds one
 * digest per audience role (HR / Finance / Ops), and dispatches an email plus
 * an `email_outbox` audit row.
 *
 * Wire-up:
 *   • `CRON_SECRET` — required auth header (`Bearer <secret>`).
 *   • `vercel.json` cron: `{ "path": "/api/cron/digest", "schedule": "0 1 * * *" }`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const vercelHeader = request.headers.get("x-vercel-cron-signature");
  return !!vercelHeader && vercelHeader === secret;
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("digest cron: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const supabase = createServiceRoleClient();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "digest",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    const { data: tenants, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, name")
      .limit(500);
    if (tenantErr) throw new Error(tenantErr.message);

    let processed = 0;
    const perTenant: Array<{
      tenant_id: string;
      recipients: number;
      sent: number;
      skipped: number;
    }> = [];

    for (const tenant of tenants ?? []) {
      const bundle = await buildTenantBundles(
        supabase,
        tenant.id,
        tenant.name,
        startedAt,
      );
      const recipients = await loadRecipients(supabase, tenant.id);

      let sent = 0;
      let skipped = 0;

      for (const r of recipients) {
        const audienceBundle: DigestBundle = {
          ...bundle,
          role_audience: r.audience,
          pending_approvals: filterApprovalsForAudience(
            bundle.pending_approvals,
            r.audience,
          ),
        };

        if (!shouldSendDigest(audienceBundle)) {
          skipped += 1;
          continue;
        }

        const subject = renderDigestSubject(audienceBundle);
        const text = renderDigestText(audienceBundle);
        const html = renderDigestHtml(audienceBundle);

        if (dryRun) {
          log.info("digest: dry-run recipient", {
            tenant_id: tenant.id,
            to: r.email,
            approvals: audienceBundle.pending_approvals.length,
            low_funds: audienceBundle.petty_cash_low_funds.length,
            sla_risks: audienceBundle.sla_breach_risks.length,
          });
          skipped += 1;
          continue;
        }

        const result = await sendEmail({
          to: r.email,
          subject,
          text,
          html,
          metadata: { tenant_id: tenant.id, audience: r.audience },
        });

        await supabase.from("email_outbox").insert({
          tenant_id: tenant.id,
          to_address: r.email,
          from_address:
            process.env.SMTP_FROM ??
            "ControlDesk <no-reply@controldesk.app>",
          subject,
          body_text: text,
          body_html: html,
          status: result.status,
          provider: result.provider,
          provider_message_id: result.providerMessageId ?? null,
          error_message: result.error ?? null,
          metadata: { audience: r.audience },
          sent_at: result.status === "SENT" ? new Date().toISOString() : null,
        });

        if (result.status === "SENT") sent += 1;
        else skipped += 1;
      }

      perTenant.push({
        tenant_id: tenant.id,
        recipients: recipients.length,
        sent,
        skipped,
      });
      processed += sent;
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: processed,
          details: { per_tenant: perTenant },
        })
        .eq("id", runId);
    }

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        emails_sent: processed,
        per_tenant: perTenant,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("digest cron failed", { error: errorMsg });
    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "FAILED",
          finished_at: new Date().toISOString(),
          error_message: errorMsg,
        })
        .eq("id", runId);
    }
    return NextResponse.json(
      { status: "failed", error: errorMsg },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------
type SupabaseClient = ReturnType<typeof createServiceRoleClient>;

async function loadRecipients(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<DigestRecipient[]> {
  const { data } = await supabase
    .from("employees")
    .select("id, full_name, email, role")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", [
      "HR_ADMIN",
      "LEAD_FINANCE",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
    ]);

  return (data ?? []).map((e) => {
    let audience: DigestRecipient["audience"] = "OPERATIONS";
    if (e.role === "HR_ADMIN") audience = "HR_ADMIN";
    else if (e.role === "LEAD_FINANCE") audience = "LEAD_FINANCE";
    return {
      employee_id: e.id,
      full_name: e.full_name,
      email: e.email,
      audience,
    };
  });
}

async function buildTenantBundles(
  supabase: SupabaseClient,
  tenantId: string,
  tenantName: string,
  now: Date,
): Promise<DigestBundle> {
  const [expenses, cashAdvances, hrRequests, replenishments, pettyCash] =
    await Promise.all([
      supabase
        .from("project_expenses")
        .select("id, description, amount, status, created_at, submitter:submitter_employee_id(full_name)")
        .eq("tenant_id", tenantId)
        .like("status", "PENDING_%")
        .order("created_at", { ascending: true })
        .limit(50),
      supabase
        .from("cash_advances")
        .select("id, purpose, amount, status, created_at, requester:requester_employee_id(full_name)")
        .eq("tenant_id", tenantId)
        .like("status", "PENDING_%")
        .order("created_at", { ascending: true })
        .limit(50),
      supabase
        .from("hr_requests")
        .select("id, reason, kind, status, created_at, requester:requester_employee_id(full_name)")
        .eq("tenant_id", tenantId)
        .like("status", "PENDING_%")
        .order("created_at", { ascending: true })
        .limit(50),
      supabase
        .from("petty_cash_replenishments")
        .select("id, requested_amount, status, created_at, requester:requested_by(full_name)")
        .eq("tenant_id", tenantId)
        .like("status", "PENDING_%")
        .order("created_at", { ascending: true })
        .limit(50),
      supabase
        .from("petty_cash_funds")
        .select("id, location_name, balance, min_balance")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .limit(50),
    ]);

  const pendingApprovals: PendingApproval[] = [];

  type ExpenseRow = {
    id: string;
    description: string;
    amount: string;
    created_at: string;
    submitter: { full_name: string } | null;
  };
  for (const e of ((expenses.data ?? []) as unknown) as ExpenseRow[]) {
    pendingApprovals.push({
      id: e.id,
      kind: "EXPENSE",
      reference: e.description,
      amount_idr: Number(e.amount ?? 0),
      submitted_by: e.submitter?.full_name ?? "—",
      submitted_at: e.created_at,
      hours_pending: computeHoursPending(e.created_at, now),
      action_url: `/finance/expenses/${e.id}`,
    });
  }

  type CashAdvanceRow = {
    id: string;
    purpose: string;
    amount: string;
    created_at: string;
    requester: { full_name: string } | null;
  };
  for (const c of ((cashAdvances.data ?? []) as unknown) as CashAdvanceRow[]) {
    pendingApprovals.push({
      id: c.id,
      kind: "CASH_ADVANCE",
      reference: c.purpose,
      amount_idr: Number(c.amount ?? 0),
      submitted_by: c.requester?.full_name ?? "—",
      submitted_at: c.created_at,
      hours_pending: computeHoursPending(c.created_at, now),
      action_url: `/finance/cash-advances/${c.id}`,
    });
  }

  type HrRow = {
    id: string;
    reason: string;
    kind: string;
    created_at: string;
    requester: { full_name: string } | null;
  };
  for (const h of ((hrRequests.data ?? []) as unknown) as HrRow[]) {
    pendingApprovals.push({
      id: h.id,
      kind: "HR_REQUEST",
      reference: `${h.kind} — ${h.reason}`,
      submitted_by: h.requester?.full_name ?? "—",
      submitted_at: h.created_at,
      hours_pending: computeHoursPending(h.created_at, now),
      action_url: `/hr/requests/${h.id}`,
    });
  }

  type ReplRow = {
    id: string;
    requested_amount: string;
    created_at: string;
    requester: { full_name: string } | null;
  };
  for (const r of ((replenishments.data ?? []) as unknown) as ReplRow[]) {
    pendingApprovals.push({
      id: r.id,
      kind: "PETTY_CASH_REPLENISHMENT",
      reference: "Petty cash replenishment",
      amount_idr: Number(r.requested_amount ?? 0),
      submitted_by: r.requester?.full_name ?? "—",
      submitted_at: r.created_at,
      hours_pending: computeHoursPending(r.created_at, now),
      action_url: `/finance/petty-cash`,
    });
  }

  type PcFundRow = {
    id: string;
    location_name: string;
    balance: string;
    min_balance: string;
  };
  const lowFunds: PettyCashLowFund[] = [];
  for (const f of ((pettyCash.data ?? []) as unknown) as PcFundRow[]) {
    const balance = Number(f.balance ?? 0);
    const threshold = Number(f.min_balance ?? 0);
    if (threshold > 0 && balance < threshold * PETTY_CASH_LOW_RATIO) {
      lowFunds.push({
        fund_name: f.location_name,
        location: f.location_name,
        balance_idr: balance,
        min_threshold_idr: threshold,
      });
    }
  }

  return {
    tenant_id: tenantId,
    tenant_name: tenantName,
    role_audience: "OPERATIONS",
    generated_at: now.toISOString(),
    pending_approvals: pendingApprovals.filter(
      (a) => a.hours_pending >= APPROVAL_AGE_THRESHOLD_HOURS,
    ),
    petty_cash_low_funds: lowFunds,
    sla_breach_risks: [], // sourced from ai_insights below
  };
}
