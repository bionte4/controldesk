import { NextResponse } from "next/server";

import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { CONTRACT_EXPIRY_THRESHOLDS_DAYS } from "@/lib/hr/directory";
import type { EmploymentType } from "@/types/database";

/**
 * Employee contract-expiry reminders (rules §12).
 *
 * `POST /api/cron/employee-contract-reminders`
 * `POST /api/cron/employee-contract-reminders?dry_run=true`
 *
 * Scans every tenant for employees whose contract will expire in one of the
 * configured horizons (30 / 14 / 7 / 1 days) and enqueues an in-app
 * notification for the HR admin(s) of that tenant.
 *
 * Skips:
 *   * `PERMANENT` employees (retirement-based end date; no reminder needed).
 *   * Rows with `contract_end_date IS NULL`.
 *   * Already-expired contracts (a separate ops task should archive them).
 *
 * Idempotency: we look up `notifications.payload->>employee_id` +
 * `payload->>threshold_days` created in the last 26 hours. If already sent
 * for that combination, we skip. This lets the cron run daily without
 * spamming HR when nothing has changed.
 *
 * Wire-up: cron entry in `vercel.json` at 08:00 WIB every day.
 *   { "path": "/api/cron/employee-contract-reminders", "schedule": "0 1 * * *" }
 *   (01:00 UTC = 08:00 Asia/Jakarta.)
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` or Vercel Cron signature.
 * Falls open in dev when `CRON_SECRET` is unset.
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

function isoDatePlusDays(from: Date, days: number): string {
  const d = new Date(from.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

type ExpiringEmployee = {
  id: string;
  tenant_id: string;
  full_name: string;
  employment_type: EmploymentType;
  contract_end_date: string;
};

type HrAdmin = {
  id: string;
  user_id: string | null;
  tenant_id: string;
};

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("employee-contract-reminders: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
  const supabase = createServiceRoleClient();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "employee_contract_reminders",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    let totalEnqueued = 0;
    const perThreshold: Record<number, number> = {};

    for (const days of CONTRACT_EXPIRY_THRESHOLDS_DAYS) {
      const targetIso = isoDatePlusDays(startedAt, days);

      // 1. Find every non-permanent employee whose contract ends exactly on
      //    the target date. Using an equality window keeps the SQL cheap and
      //    avoids duplicate reminders across thresholds.
      const { data: expiring, error: expiringErr } = await supabase
        .from("employees")
        .select("id, tenant_id, full_name, employment_type, contract_end_date")
        .neq("employment_type", "PERMANENT")
        .eq("contract_end_date", targetIso)
        .eq("is_active", true);
      if (expiringErr) throw new Error(expiringErr.message);
      const employees = (expiring ?? []) as ExpiringEmployee[];
      if (employees.length === 0) continue;

      // 2. Group by tenant so we hit `employees` once per tenant to fetch
      //    HR admins that should receive the notification.
      const tenantIds = Array.from(new Set(employees.map((e) => e.tenant_id)));
      const { data: hrAdmins, error: hrErr } = await supabase
        .from("employees")
        .select("id, user_id, tenant_id")
        .in("tenant_id", tenantIds)
        .in("role", ["HR_ADMIN", "TENANT_ADMIN"])
        .eq("is_active", true);
      if (hrErr) throw new Error(hrErr.message);
      const adminsByTenant = new Map<string, HrAdmin[]>();
      for (const admin of (hrAdmins ?? []) as HrAdmin[]) {
        const list = adminsByTenant.get(admin.tenant_id) ?? [];
        list.push(admin);
        adminsByTenant.set(admin.tenant_id, list);
      }

      // 3. Fan out notifications, respecting the idempotency window.
      for (const emp of employees) {
        const admins = adminsByTenant.get(emp.tenant_id) ?? [];
        if (admins.length === 0) continue;

        // Idempotency: has any admin in this tenant already been notified
        // about this (employee, threshold) in the past 26 hours?
        const since = new Date(
          startedAt.getTime() - 26 * 3_600_000,
        ).toISOString();
        const { count: existingCount, error: existsErr } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", emp.tenant_id)
          .eq("kind", "EMPLOYEE_CONTRACT_EXPIRING")
          .contains("payload", {
            employee_id: emp.id,
            threshold_days: days,
          })
          .gte("created_at", since);
        if (existsErr) throw new Error(existsErr.message);
        if ((existingCount ?? 0) > 0) continue;

        const title =
          days === 1
            ? `Kontrak ${emp.full_name} berakhir besok`
            : `Kontrak ${emp.full_name} berakhir dalam ${days} hari`;
        const body = `${emp.employment_type} · ${emp.contract_end_date}`;

        const rows = admins
          .filter((admin) => admin.user_id !== null)
          .map((admin) => ({
            tenant_id: emp.tenant_id,
            user_id: admin.user_id!,
            employee_id: admin.id,
            kind: "EMPLOYEE_CONTRACT_EXPIRING" as const,
            title,
            body,
            action_url: `/hr/employees?highlight=${emp.id}`,
            payload: {
              employee_id: emp.id,
              employment_type: emp.employment_type,
              contract_end_date: emp.contract_end_date,
              threshold_days: days,
            },
          }));

        if (rows.length === 0) continue;

        if (!dryRun) {
          const { error: insertErr } = await supabase
            .from("notifications")
            .insert(rows);
          if (insertErr) {
            log.warn("employee-contract-reminders: notify insert failed", {
              employee_id: emp.id,
              error: insertErr.message,
            });
            continue;
          }
        }
        totalEnqueued += rows.length;
        perThreshold[days] = (perThreshold[days] ?? 0) + rows.length;
      }
    }

    // ---------------------------------------------------------------
    // Evaluation-due reminders (rules §6 HR / §12). Reuses the same
    // date-of-interest computed above but only fires at 30/14/7-day
    // horizons so SPVs have time to complete the review before
    // contract end.
    // ---------------------------------------------------------------
    const EVAL_THRESHOLDS = [30, 14, 7] as const;
    let evalEnqueued = 0;
    for (const days of EVAL_THRESHOLDS) {
      const targetIso = isoDatePlusDays(startedAt, days);
      const { data: expiring, error: expiringErr } = await supabase
        .from("employees")
        .select(
          "id, tenant_id, full_name, employment_type, contract_end_date, reports_to_employee_id",
        )
        .neq("employment_type", "PERMANENT")
        .eq("contract_end_date", targetIso)
        .eq("is_active", true);
      if (expiringErr) throw new Error(expiringErr.message);
      const rows = expiring ?? [];
      if (rows.length === 0) continue;

      for (const emp of rows) {
        // Skip if this employee already has an in-flight evaluation.
        const { count: openCount } = await supabase
          .from("performance_evaluations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", emp.tenant_id)
          .eq("employee_id", emp.id)
          .not("status", "in", "(FINALIZED,REJECTED_BY_OM)");
        if ((openCount ?? 0) > 0) continue;

        // Notify the direct supervisor if we can resolve them via
        // reports_to. Fallback: broadcast to SUPERVISOR role.
        const recipients: Array<{ user_id: string; employee_id: string }> = [];
        if (emp.reports_to_employee_id) {
          const { data: spv } = await supabase
            .from("employees")
            .select("id, user_id")
            .eq("id", emp.reports_to_employee_id)
            .maybeSingle();
          if (spv?.user_id) {
            recipients.push({ user_id: spv.user_id, employee_id: spv.id });
          }
        }
        if (recipients.length === 0) {
          const { data: fallback } = await supabase
            .from("employees")
            .select("id, user_id")
            .eq("tenant_id", emp.tenant_id)
            .in("role", ["SUPERVISOR", "HR_ADMIN", "TENANT_ADMIN"])
            .eq("is_active", true);
          for (const r of fallback ?? []) {
            if (r.user_id) {
              recipients.push({ user_id: r.user_id, employee_id: r.id });
            }
          }
        }
        if (recipients.length === 0) continue;

        // Idempotency 26h window on (employee, threshold).
        const since = new Date(
          startedAt.getTime() - 26 * 3_600_000,
        ).toISOString();
        const { count: dupeCount } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", emp.tenant_id)
          .eq("kind", "EVALUATION_DUE")
          .contains("payload", { employee_id: emp.id, threshold_days: days })
          .gte("created_at", since);
        if ((dupeCount ?? 0) > 0) continue;

        const title = `Evaluasi kontrak ${emp.full_name} — H-${days}`;
        const body = `Kontrak berakhir ${emp.contract_end_date}. Silakan mulai form evaluasi.`;
        const notifyRows = recipients.map((r) => ({
          tenant_id: emp.tenant_id,
          user_id: r.user_id,
          employee_id: r.employee_id,
          kind: "EVALUATION_DUE" as const,
          title,
          body,
          action_url: `/hr/performance?employee=${emp.id}`,
          payload: {
            employee_id: emp.id,
            employment_type: emp.employment_type,
            contract_end_date: emp.contract_end_date,
            threshold_days: days,
          },
        }));
        if (!dryRun && notifyRows.length > 0) {
          const { error: insErr } = await supabase
            .from("notifications")
            .insert(notifyRows);
          if (insErr) {
            log.warn("employee-contract-reminders: eval notify failed", {
              employee_id: emp.id,
              error: insErr.message,
            });
            continue;
          }
        }
        evalEnqueued += notifyRows.length;
      }
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: totalEnqueued + evalEnqueued,
          details: {
            per_threshold: perThreshold,
            thresholds: [...CONTRACT_EXPIRY_THRESHOLDS_DAYS],
            eval_enqueued: evalEnqueued,
          },
        })
        .eq("id", runId);
    }

    log.info("employee-contract-reminders finished", {
      dry_run: dryRun,
      enqueued: totalEnqueued,
      per_threshold: perThreshold,
    });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        enqueued: totalEnqueued,
        eval_enqueued: evalEnqueued,
        per_threshold: perThreshold,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("employee-contract-reminders failed", { error: errorMsg });
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
