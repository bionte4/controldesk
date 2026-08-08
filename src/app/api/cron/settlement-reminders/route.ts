import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { businessDaysUntil } from "@/lib/format/business-days";
import { formatInTz } from "@/lib/format/date";
import { parseMoneyFromDb } from "@/lib/format/money";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { log } from "@/lib/observability/log";
import { sendEmail } from "@/lib/notify/mailer";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type {
  AnyDbEmployeeRole,
  EmployeeRole,
} from "@/lib/rbac/roles";
import type { NotificationKind } from "@/types/database";

/**
 * Settlement SLA reminders (rules §11 revisi 2026-08 + §20).
 *
 * `POST /api/cron/settlement-reminders`
 * `POST /api/cron/settlement-reminders?dry_run=true`
 *
 * Menjalankan 2 sweep harian per tenant:
 *
 *   1. Cash Advance settlement — CA `DISBURSED` yang belum `SETTLED`
 *      dievaluasi terhadap `settlement_due_at`. Reminder dikirim ke pengaju
 *      pada offset -3, 0 (business days SEBELUM due), dan escalation ke
 *      Supervisor/PM/OM pada +1, +3, +7 (setelah lewat due). Semua idempotent
 *      via tabel `settlement_sla_reminders` (unique index atas tenant +
 *      resource + reminder_kind).
 *
 *   2. Expense DRAFT stale — expense yang tetap DRAFT lebih dari 7 hari
 *      kerja sejak `updated_at` mendapat pengingat sekali ke submitter.
 *      Idempotent via reminder_kind = 'DRAFT_STALE'.
 *
 * Kanal:
 *   - In-app notification (`notifications` table, direct insert via service
 *     role client karena RLS block insert dari client biasa).
 *   - Email (best-effort via `sendEmail`; kalau SMTP unset, log skip).
 *
 * Wire-up: cron entry di `vercel.json` jam 08:00 WIB:
 *   { "path": "/api/cron/settlement-reminders", "schedule": "0 1 * * *" }
 *   (01:00 UTC = 08:00 Asia/Jakarta.)
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` atau Vercel Cron signature.
 * Falls open di dev saat `CRON_SECRET` tidak diset.
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

// ---------------------------------------------------------------------------
// Reminder schedule — must match settlement_sla_reminders.reminder_kind check.
// ---------------------------------------------------------------------------

type CaReminderRule = {
  reminderKind: "T-3" | "T-0" | "T+1" | "T+3" | "T+7";
  /**
   * `businessDaysUntil(due, now)`. Positif = due masih di depan; negatif =
   * sudah lewat. T-3 → due 3 wd di depan (delta +3). T+1 → lewat 1 wd
   * (delta -1). T-0 → hari terakhir (delta 0).
   */
  businessDaysDelta: number;
  notificationKind: NotificationKind;
  escalateRoles: readonly (EmployeeRole | AnyDbEmployeeRole)[] | null;
  titleKey: string;
  bodyKey: string;
  escalationTitleKey?: string;
  escalationBodyKey?: string;
};

const CA_RULES: readonly CaReminderRule[] = [
  {
    reminderKind: "T-3",
    businessDaysDelta: 3,
    notificationKind: "SETTLEMENT_DUE_SOON",
    escalateRoles: null,
    titleKey: "ca.dueSoon.title",
    bodyKey: "ca.dueSoon.body",
  },
  {
    reminderKind: "T-0",
    businessDaysDelta: 0,
    notificationKind: "SETTLEMENT_DUE_SOON",
    escalateRoles: null,
    titleKey: "ca.dueToday.title",
    bodyKey: "ca.dueToday.body",
  },
  {
    reminderKind: "T+1",
    businessDaysDelta: -1,
    notificationKind: "SETTLEMENT_OVERDUE",
    escalateRoles: ["SUPERVISOR", "TENANT_ADMIN"],
    titleKey: "ca.overdue.title",
    bodyKey: "ca.overdue.body",
    escalationTitleKey: "ca.escalationSupervisor.title",
    escalationBodyKey: "ca.escalationSupervisor.body",
  },
  {
    reminderKind: "T+3",
    businessDaysDelta: -3,
    notificationKind: "SETTLEMENT_OVERDUE",
    escalateRoles: ["PROJECT_MANAGER", "PM", "TENANT_ADMIN"],
    titleKey: "ca.overdue.title",
    bodyKey: "ca.overdue.body",
    escalationTitleKey: "ca.escalationPm.title",
    escalationBodyKey: "ca.escalationPm.body",
  },
  {
    reminderKind: "T+7",
    businessDaysDelta: -7,
    notificationKind: "SETTLEMENT_OVERDUE",
    escalateRoles: ["OPERATIONS_MANAGER", "OM", "TENANT_ADMIN"],
    titleKey: "ca.overdue.title",
    bodyKey: "ca.overdue.body",
    escalationTitleKey: "ca.escalationOm.title",
    escalationBodyKey: "ca.escalationOm.body",
  },
];

const EXPENSE_DRAFT_STALE_THRESHOLD_WD = 7;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

type Tenant = { id: string; name: string; timezone: string };
type EmployeeRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string;
  preferred_locale: string | null;
  tenant_id: string;
  role: string;
};

async function loadTenants(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, timezone")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    timezone: (t.timezone as string) ?? "Asia/Jakarta",
  }));
}

function resolveLocale(raw: string | null | undefined): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

async function translatorForLocale(
  locale: Locale,
  namespace: string,
): Promise<(key: string, values?: Record<string, string | number>) => string> {
  const raw = await getTranslations({ locale, namespace: namespace as never });
  return (key, values) =>
    (raw as unknown as (
      k: string,
      v?: Record<string, string | number>,
    ) => string)(key, values);
}

async function insertNotification(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: {
    tenantId: string;
    userId: string;
    employeeId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    actionUrl: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    tenant_id: row.tenantId,
    user_id: row.userId,
    employee_id: row.employeeId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    action_url: row.actionUrl,
    payload: row.payload as never,
  });
  if (error) {
    log.warn("settlement-reminders: notification insert failed", {
      error: error.message,
      tenant_id: row.tenantId,
    });
  }
}

async function recordReminder(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  resourceType: "cash_advance" | "expense_draft" | "expense_incurred",
  resourceId: string,
  reminderKind: string,
  businessDaysDelta: number,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await supabase.from("settlement_sla_reminders").insert({
    tenant_id: tenantId,
    resource_type: resourceType,
    resource_id: resourceId,
    reminder_kind: reminderKind,
    business_days_offset: businessDaysDelta,
    metadata: metadata as never,
  });
  if (error) {
    // Unique-violation (23505) means we already recorded this reminder for
    // this run — treat as no-op so idempotency remains intact.
    if ((error as { code?: string }).code === "23505") return false;
    log.warn("settlement-reminders: reminder ledger insert failed", {
      error: error.message,
      resource_type: resourceType,
      resource_id: resourceId,
      reminder_kind: reminderKind,
    });
    return false;
  }
  return true;
}

async function sendReminderEmail(
  supabase: ReturnType<typeof createServiceRoleClient>,
  input: {
    tenantId: string;
    to: string;
    subject: string;
    text: string;
    actionUrl: string;
  },
): Promise<void> {
  const result = await sendEmail({
    to: input.to,
    subject: input.subject,
    text: input.text + `\n\n${input.actionUrl}`,
  });
  await supabase.from("email_outbox").insert({
    tenant_id: input.tenantId,
    to_address: input.to,
    from_address:
      process.env.SMTP_FROM ?? "ControlDesk <no-reply@controldesk.app>",
    subject: input.subject,
    body_text: input.text,
    body_html: null,
    status: result.status,
    provider: result.provider,
    provider_message_id: result.providerMessageId ?? null,
    error_message: result.error ?? null,
    metadata: { source: "settlement-reminders" },
    sent_at: result.status === "SENT" ? new Date().toISOString() : null,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("settlement-reminders: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
  const supabase = createServiceRoleClient();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "settlement_reminders",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  const stats = {
    ca_notifications: 0,
    ca_escalations: 0,
    ca_emails: 0,
    expense_draft_notifications: 0,
    expense_draft_emails: 0,
    skipped_no_recipient: 0,
  };

  try {
    const tenants = await loadTenants(supabase);

    for (const tenant of tenants) {
      // -----------------------------------------------------------------
      // 1. Cash Advance settlement reminders
      // -----------------------------------------------------------------
      const { data: cas, error: caErr } = await supabase
        .from("cash_advances")
        .select(
          "id, tenant_id, project_id, amount, requester_employee_id, disbursed_at, settlement_due_at, purpose",
        )
        .eq("tenant_id", tenant.id)
        .eq("status", "DISBURSED")
        .is("settled_at", null)
        .not("settlement_due_at", "is", null);
      if (caErr) throw new Error(caErr.message);

      for (const ca of cas ?? []) {
        if (!ca.settlement_due_at || !ca.requester_employee_id) continue;
        const delta = businessDaysUntil(
          ca.settlement_due_at,
          startedAt,
          tenant.timezone,
        );
        const rule = CA_RULES.find((r) => r.businessDaysDelta === delta);
        if (!rule) continue;

        // Requester profile
        const { data: submitterRow } = await supabase
          .from("employees")
          .select(
            "id, user_id, email, full_name, preferred_locale, tenant_id, role",
          )
          .eq("id", ca.requester_employee_id)
          .maybeSingle();
        const submitter = (submitterRow ?? null) as EmployeeRow | null;
        if (!submitter?.user_id) {
          stats.skipped_no_recipient += 1;
          continue;
        }

        // Guard idempotency BEFORE side effects.
        const inserted = dryRun
          ? true
          : await recordReminder(
              supabase,
              tenant.id,
              "cash_advance",
              ca.id,
              rule.reminderKind,
              rule.businessDaysDelta,
              {
                submitter_employee_id: submitter.id,
                amount_idr: parseMoneyFromDb(ca.amount),
                settlement_due_at: ca.settlement_due_at,
              },
            );
        if (!inserted) continue;

        const amountIDR = Number(parseMoneyFromDb(ca.amount));
        const deadlineStr = formatInTz(
          ca.settlement_due_at,
          "dd MMM yyyy",
          tenant.timezone,
        );

        // Submitter notification (locale-aware)
        const locale = resolveLocale(submitter.preferred_locale);
        const t = await translatorForLocale(locale, "notifications.settlementReminders");
        const title = t(rule.titleKey, {
          amount: amountIDR.toLocaleString("id-ID"),
          days: Math.abs(rule.businessDaysDelta) || 1,
          deadline: deadlineStr,
        });
        const body = t(rule.bodyKey, {
          amount: amountIDR.toLocaleString("id-ID"),
          days: Math.abs(rule.businessDaysDelta) || 1,
          deadline: deadlineStr,
        });
        const actionUrl = `/finance/cash-advances/${ca.id}`;

        if (!dryRun) {
          await insertNotification(supabase, {
            tenantId: tenant.id,
            userId: submitter.user_id,
            employeeId: submitter.id,
            kind: rule.notificationKind,
            title,
            body,
            actionUrl,
            payload: {
              cash_advance_id: ca.id,
              reminder_kind: rule.reminderKind,
              business_days_delta: rule.businessDaysDelta,
            },
          });
          if (submitter.email) {
            await sendReminderEmail(supabase, {
              tenantId: tenant.id,
              to: submitter.email,
              subject: title,
              text: body,
              actionUrl,
            });
            stats.ca_emails += 1;
          }
        }
        stats.ca_notifications += 1;

        // Escalation: fan out to designated roles on overdue days.
        if (rule.escalateRoles && rule.escalationTitleKey && rule.escalationBodyKey) {
          const { data: escalators } = await supabase
            .from("employees")
            .select("id, user_id, email, full_name, preferred_locale, tenant_id, role")
            .eq("tenant_id", tenant.id)
            .eq("is_active", true)
            .in("role", [...rule.escalateRoles] as never);
          for (const es of (escalators ?? []) as EmployeeRow[]) {
            if (!es.user_id) continue;
            const esLocale = resolveLocale(es.preferred_locale);
            const tt = await translatorForLocale(
              esLocale,
              "notifications.settlementReminders",
            );
            const esTitle = tt(rule.escalationTitleKey!, {
              submitter: submitter.full_name,
              amount: amountIDR.toLocaleString("id-ID"),
              days: Math.abs(rule.businessDaysDelta),
              deadline: deadlineStr,
            });
            const esBody = tt(rule.escalationBodyKey!, {
              submitter: submitter.full_name,
              amount: amountIDR.toLocaleString("id-ID"),
              days: Math.abs(rule.businessDaysDelta),
              deadline: deadlineStr,
            });
            if (!dryRun) {
              await insertNotification(supabase, {
                tenantId: tenant.id,
                userId: es.user_id,
                employeeId: es.id,
                kind: rule.notificationKind,
                title: esTitle,
                body: esBody,
                actionUrl,
                payload: {
                  cash_advance_id: ca.id,
                  reminder_kind: rule.reminderKind,
                  escalation_role: es.role,
                },
              });
            }
            stats.ca_escalations += 1;
          }
        }
      }

      // -----------------------------------------------------------------
      // 2. Expense DRAFT stale reminders (>= 7 wd)
      // -----------------------------------------------------------------
      const { data: expenses, error: expErr } = await supabase
        .from("project_expenses")
        .select(
          "id, tenant_id, project_id, amount, submitter_employee_id, updated_at, description",
        )
        .eq("tenant_id", tenant.id)
        .eq("status", "DRAFT");
      if (expErr) throw new Error(expErr.message);

      for (const exp of expenses ?? []) {
        if (!exp.updated_at || !exp.submitter_employee_id) continue;
        const wdOld = -businessDaysUntil(
          exp.updated_at,
          startedAt,
          tenant.timezone,
        );
        if (wdOld < EXPENSE_DRAFT_STALE_THRESHOLD_WD) continue;

        const { data: submitterRow } = await supabase
          .from("employees")
          .select("id, user_id, email, full_name, preferred_locale, tenant_id, role")
          .eq("id", exp.submitter_employee_id)
          .maybeSingle();
        const submitter = (submitterRow ?? null) as EmployeeRow | null;
        if (!submitter?.user_id) {
          stats.skipped_no_recipient += 1;
          continue;
        }

        const inserted = dryRun
          ? true
          : await recordReminder(
              supabase,
              tenant.id,
              "expense_draft",
              exp.id,
              "DRAFT_STALE",
              wdOld,
              {
                submitter_employee_id: submitter.id,
                amount_idr: parseMoneyFromDb(exp.amount),
                updated_at: exp.updated_at,
              },
            );
        if (!inserted) continue;

        const amountIDR = Number(parseMoneyFromDb(exp.amount));
        const locale = resolveLocale(submitter.preferred_locale);
        const t = await translatorForLocale(locale, "notifications.settlementReminders");
        const title = t("expenseDraft.stale.title", {
          amount: amountIDR.toLocaleString("id-ID"),
          days: wdOld,
        });
        const body = t("expenseDraft.stale.body", {
          amount: amountIDR.toLocaleString("id-ID"),
          days: wdOld,
        });
        const actionUrl = `/finance/expenses/${exp.id}`;

        if (!dryRun) {
          await insertNotification(supabase, {
            tenantId: tenant.id,
            userId: submitter.user_id,
            employeeId: submitter.id,
            kind: "EXPENSE_DRAFT_STALE",
            title,
            body,
            actionUrl,
            payload: {
              expense_id: exp.id,
              business_days_old: wdOld,
            },
          });
          if (submitter.email) {
            await sendReminderEmail(supabase, {
              tenantId: tenant.id,
              to: submitter.email,
              subject: title,
              text: body,
              actionUrl,
            });
            stats.expense_draft_emails += 1;
          }
        }
        stats.expense_draft_notifications += 1;
      }
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed:
            stats.ca_notifications +
            stats.ca_escalations +
            stats.expense_draft_notifications,
          details: { ...stats },
        })
        .eq("id", runId);
    }

    log.info("settlement-reminders finished", { dry_run: dryRun, ...stats });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        stats,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("settlement-reminders failed", { error: errorMsg });
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
