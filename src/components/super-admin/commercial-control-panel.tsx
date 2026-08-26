"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createManualInvoiceAction,
  updateCommercialControlAction,
  updateManualInvoiceStatusAction,
  upsertEntitlementOverrideAction,
} from "@/app/(super-admin)/super-admin/actions";

type JsonRecord = Record<string, unknown>;

export type CommercialControlData = {
  tenantId: string;
  profile: JsonRecord | null;
  onboarding: JsonRecord | null;
  subscription: JsonRecord | null;
  usage: JsonRecord | null;
  entitlements: Array<JsonRecord>;
  overrides: Array<JsonRecord>;
  invoices: Array<JsonRecord>;
  health: JsonRecord | null;
  sessionPolicy: JsonRecord;
};

const checklistKeys = [
  "kickoff",
  "master_data",
  "users_invited",
  "approval_configured",
  "project_setup",
  "training",
  "first_live_transaction",
] as const;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) =>
  typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
const dateTimeLocal = (value: unknown) =>
  typeof value === "string" && value ? value.slice(0, 16) : "";
const toIso = (value: FormDataEntryValue | null) => {
  const raw = String(value ?? "");
  return raw ? new Date(raw).toISOString() : "";
};

export function CommercialControlPanel({ data }: { data: CommercialControlData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const profile = data.profile ?? {};
  const onboarding = data.onboarding ?? {};
  const subscription = data.subscription ?? {};
  const checklist = (onboarding.checklist ?? {}) as Record<string, boolean>;
  const successCriteria = Array.isArray(onboarding.success_criteria)
    ? onboarding.success_criteria.join("\n")
    : "";

  const saveControlPlane = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setMessage(null);
    startTransition(async () => {
      const result = await updateCommercialControlAction({
        tenant_id: data.tenantId,
        profile: {
          stage: fd.get("stage"),
          industry_segment: fd.get("industry_segment"),
          acquisition_source: fd.get("acquisition_source"),
          sales_owner: fd.get("sales_owner"),
          customer_success_owner: fd.get("customer_success_owner"),
          economic_buyer_name: fd.get("economic_buyer_name"),
          economic_buyer_email: fd.get("economic_buyer_email"),
          champion_name: fd.get("champion_name"),
          champion_email: fd.get("champion_email"),
          engineer_count: fd.get("engineer_count") ? Number(fd.get("engineer_count")) : null,
          estimated_active_projects: fd.get("estimated_active_projects")
            ? Number(fd.get("estimated_active_projects"))
            : null,
          notes: fd.get("profile_notes"),
        },
        onboarding: {
          status: fd.get("onboarding_status"),
          pilot_start_date: fd.get("pilot_start_date"),
          pilot_end_date: fd.get("pilot_end_date"),
          decision_date: fd.get("decision_date"),
          blocker: fd.get("blocker"),
          technical_activated_at: toIso(fd.get("technical_activated_at")),
          business_activated_at: toIso(fd.get("business_activated_at")),
          success_criteria: String(fd.get("success_criteria") ?? "")
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          checklist: Object.fromEntries(
            checklistKeys.map((key) => [key, fd.get(`checklist_${key}`) === "on"]),
          ),
        },
        subscription: {
          plan_code: fd.get("plan_code"),
          status: fd.get("subscription_status"),
          billing_interval: fd.get("billing_interval"),
          recurring_price_idr: Number(fd.get("recurring_price_idr") ?? 0),
          implementation_fee_idr: Number(fd.get("implementation_fee_idr") ?? 0),
          contract_start_date: fd.get("contract_start_date"),
          contract_end_date: fd.get("contract_end_date"),
          renewal_date: fd.get("renewal_date"),
          payment_terms_days: Number(fd.get("payment_terms_days") ?? 30),
          grace_ends_at: toIso(fd.get("grace_ends_at")),
          read_only_at: toIso(fd.get("read_only_at")),
          suspend_at: toIso(fd.get("suspend_at")),
          cancellation_reason: fd.get("cancellation_reason"),
          auto_renew: fd.get("auto_renew") === "on",
        },
        session_policy: {
          idle_timeout_minutes: Number(fd.get("idle_timeout_minutes") ?? 30),
          idle_warning_minutes: Number(fd.get("idle_warning_minutes") ?? 2),
          absolute_session_minutes: Number(fd.get("absolute_session_minutes") ?? 480),
        },
      });
      setMessage(result.ok ? "Commercial control plane berhasil disimpan." : result.reason);
      if (result.ok) router.refresh();
    });
  };

  const saveOverride = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const enabledRaw = String(fd.get("enabled") ?? "inherit");
      const result = await upsertEntitlementOverrideAction({
        tenant_id: data.tenantId,
        capability_key: fd.get("capability_key"),
        enabled: enabledRaw === "inherit" ? null : enabledRaw === "true",
        limit_value: fd.get("limit_value") ? Number(fd.get("limit_value")) : null,
        reason: fd.get("reason"),
        expires_at: toIso(fd.get("expires_at")),
      });
      setMessage(result.ok ? "Override entitlement berhasil disimpan." : result.reason);
      if (result.ok) {
        form.reset();
        router.refresh();
      }
    });
  };

  const createInvoice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const result = await createManualInvoiceAction({
        tenant_id: data.tenantId,
        subscription_id: text(subscription.id) || null,
        invoice_number: fd.get("invoice_number"),
        status: fd.get("invoice_status"),
        amount_idr: Number(fd.get("amount_idr") ?? 0),
        issued_at: fd.get("issued_at"),
        due_at: fd.get("due_at"),
        payment_reference: fd.get("payment_reference"),
        notes: fd.get("invoice_notes"),
      });
      setMessage(result.ok ? "Invoice manual berhasil dicatat." : result.reason);
      if (result.ok) {
        form.reset();
        router.refresh();
      }
    });
  };

  const markInvoicePaid = (invoiceId: string) => {
    startTransition(async () => {
      const result = await updateManualInvoiceStatusAction({
        tenant_id: data.tenantId,
        invoice_id: invoiceId,
        status: "paid",
      });
      setMessage(result.ok ? "Invoice ditandai paid." : result.reason);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {message && (
        <div role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
          {message}
        </div>
      )}

      <form onSubmit={saveControlPlane} className="space-y-6">
        <Panel title="Commercial profile" description="Buyer, ownership, segment, dan tahapan hubungan komersial.">
          <Field label="Commercial stage"><Select name="stage" defaultValue={text(profile.stage) || "trial"} options={["lead","qualified","trial","pilot","customer","churned"]} /></Field>
          <Field label="Industry segment"><Input name="industry_segment" defaultValue={text(profile.industry_segment)} /></Field>
          <Field label="Acquisition source"><Input name="acquisition_source" defaultValue={text(profile.acquisition_source)} /></Field>
          <Field label="Sales owner"><Input name="sales_owner" defaultValue={text(profile.sales_owner)} /></Field>
          <Field label="Customer success owner"><Input name="customer_success_owner" defaultValue={text(profile.customer_success_owner)} /></Field>
          <Field label="Economic buyer"><Input name="economic_buyer_name" defaultValue={text(profile.economic_buyer_name)} /></Field>
          <Field label="Economic buyer email"><Input type="email" name="economic_buyer_email" defaultValue={text(profile.economic_buyer_email)} /></Field>
          <Field label="Internal champion"><Input name="champion_name" defaultValue={text(profile.champion_name)} /></Field>
          <Field label="Champion email"><Input type="email" name="champion_email" defaultValue={text(profile.champion_email)} /></Field>
          <Field label="Engineer count"><Input type="number" min="0" name="engineer_count" defaultValue={profile.engineer_count == null ? "" : number(profile.engineer_count)} /></Field>
          <Field label="Estimated active projects"><Input type="number" min="0" name="estimated_active_projects" defaultValue={profile.estimated_active_projects == null ? "" : number(profile.estimated_active_projects)} /></Field>
          <Field label="Notes" wide><Textarea name="profile_notes" defaultValue={text(profile.notes)} /></Field>
        </Panel>

        <Panel title="Enterprise session policy" description="Server-enforced idle timeout dan absolute lifetime. Perubahan berlaku pada request berikutnya.">
          <Field label="Idle timeout (minutes)"><Input required type="number" min="5" max="1440" name="idle_timeout_minutes" defaultValue={number(data.sessionPolicy.idle_timeout_minutes) || 30} /></Field>
          <Field label="Warning before logout (minutes)"><Input required type="number" min="1" max="60" name="idle_warning_minutes" defaultValue={number(data.sessionPolicy.idle_warning_minutes) || 2} /></Field>
          <Field label="Absolute session lifetime (minutes)"><Input required type="number" min="30" max="10080" name="absolute_session_minutes" defaultValue={number(data.sessionPolicy.absolute_session_minutes) || 480} /></Field>
          <div className="text-xs text-zinc-500">Absolute lifetime tidak diperpanjang oleh aktivitas atau multi-tab heartbeat.</div>
        </Panel>

        <Panel title="Paid pilot & onboarding" description="Pilot harus memiliki scope, tanggal keputusan, dan activation yang terukur.">
          <Field label="Onboarding status"><Select name="onboarding_status" defaultValue={text(onboarding.status) || "new"} options={["new","configuring","activated","stalled"]} /></Field>
          <Field label="Pilot start"><Input type="date" name="pilot_start_date" defaultValue={text(onboarding.pilot_start_date)} /></Field>
          <Field label="Pilot end"><Input type="date" name="pilot_end_date" defaultValue={text(onboarding.pilot_end_date)} /></Field>
          <Field label="Decision date"><Input type="date" name="decision_date" defaultValue={text(onboarding.decision_date)} /></Field>
          <Field label="Technical activation"><Input type="datetime-local" name="technical_activated_at" defaultValue={dateTimeLocal(onboarding.technical_activated_at)} /></Field>
          <Field label="Business activation"><Input type="datetime-local" name="business_activated_at" defaultValue={dateTimeLocal(onboarding.business_activated_at)} /></Field>
          <Field label="Blocker" wide><Textarea name="blocker" defaultValue={text(onboarding.blocker)} /></Field>
          <Field label="Success criteria (satu per baris)" wide><Textarea name="success_criteria" defaultValue={successCriteria} rows={5} /></Field>
          <div className="sm:col-span-2">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Activation checklist</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {checklistKeys.map((key) => <label key={key} className="flex items-center gap-2 rounded border border-zinc-200 p-2 text-xs dark:border-zinc-700"><input type="checkbox" name={`checklist_${key}`} defaultChecked={Boolean(checklist[key])} />{key.replaceAll("_", " ")}</label>)}
            </div>
          </div>
        </Panel>

        <Panel title="Subscription & access" description="Invoice tetap manual. Grace dan read-only terpisah dari suspend teknis.">
          <Field label="Plan"><Select name="plan_code" defaultValue={text(subscription.plan_code) || "trial"} options={["trial","field_control","project_margin","service_governance","custom"]} /></Field>
          <Field label="Subscription status"><Select name="subscription_status" defaultValue={text(subscription.status) || "trialing"} options={["trialing","active","past_due","canceled","expired"]} /></Field>
          <Field label="Billing interval"><Select name="billing_interval" defaultValue={text(subscription.billing_interval) || "annual"} options={["monthly","quarterly","annual","one_time"]} /></Field>
          <Field label="Recurring price IDR"><Input type="number" min="0" name="recurring_price_idr" defaultValue={number(subscription.recurring_price_idr)} /></Field>
          <Field label="Implementation fee IDR"><Input type="number" min="0" name="implementation_fee_idr" defaultValue={number(subscription.implementation_fee_idr)} /></Field>
          <Field label="Payment terms (days)"><Input type="number" min="0" max="365" name="payment_terms_days" defaultValue={number(subscription.payment_terms_days) || 30} /></Field>
          <Field label="Contract start"><Input type="date" name="contract_start_date" defaultValue={text(subscription.contract_start_date)} /></Field>
          <Field label="Contract end"><Input type="date" name="contract_end_date" defaultValue={text(subscription.contract_end_date)} /></Field>
          <Field label="Renewal date"><Input type="date" name="renewal_date" defaultValue={text(subscription.renewal_date)} /></Field>
          <Field label="Grace ends"><Input type="datetime-local" name="grace_ends_at" defaultValue={dateTimeLocal(subscription.grace_ends_at)} /></Field>
          <Field label="Read-only starts"><Input type="datetime-local" name="read_only_at" defaultValue={dateTimeLocal(subscription.read_only_at)} /></Field>
          <Field label="Suspend starts"><Input type="datetime-local" name="suspend_at" defaultValue={dateTimeLocal(subscription.suspend_at)} /></Field>
          <Field label="Cancellation reason"><Input name="cancellation_reason" defaultValue={text(subscription.cancellation_reason)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="auto_renew" defaultChecked={Boolean(subscription.auto_renew)} />Auto renew</label>
        </Panel>

        <button disabled={pending} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">{pending ? "Menyimpan…" : "Simpan commercial control plane"}</button>
      </form>

      <Panel title="Usage & effective entitlements" description="Usage aktual dibandingkan dengan limit paket dan override kontraktual.">
        <div className="sm:col-span-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {["active_users","active_projects","portal_users","cash_advances_total"].map((key) => <Metric key={key} label={key.replaceAll("_", " ")} value={number(data.usage?.[key])} />)}
        </div>
        <div className="sm:col-span-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-zinc-500"><th className="py-2">Capability</th><th>Enabled</th><th>Limit</th><th>Override</th></tr></thead><tbody>{data.entitlements.map((row) => { const override = data.overrides.find((item) => item.capability_key === row.capability_key); return <tr key={text(row.capability_key)} className="border-t border-zinc-100 dark:border-zinc-800"><td className="py-2 font-mono text-xs">{text(row.capability_key)}</td><td>{String(override?.enabled ?? row.enabled)}</td><td>{String(override?.limit_value ?? row.limit_value ?? "∞")}</td><td>{override ? text(override.reason) : "—"}</td></tr>; })}</tbody></table></div>
      </Panel>

      <form onSubmit={saveOverride}><Panel title="Entitlement override" description="Override harus memiliki alasan dan dapat diberi expiry.">
        <Field label="Capability"><Input required name="capability_key" /></Field><Field label="Enabled"><Select name="enabled" defaultValue="inherit" options={["inherit","true","false"]} /></Field><Field label="Limit"><Input type="number" min="0" name="limit_value" /></Field><Field label="Expires"><Input type="datetime-local" name="expires_at" /></Field><Field label="Reason" wide><Input required minLength={3} name="reason" /></Field><button disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">Simpan override</button>
      </Panel></form>

      <form onSubmit={createInvoice}><Panel title="Manual invoice ledger" description="Pencatatan invoice dan pembayaran tanpa payment gateway.">
        <Field label="Invoice number"><Input required name="invoice_number" /></Field><Field label="Status"><Select name="invoice_status" defaultValue="draft" options={["draft","issued","paid","overdue","void"]} /></Field><Field label="Amount IDR"><Input required type="number" min="0" name="amount_idr" /></Field><Field label="Issued"><Input type="date" name="issued_at" /></Field><Field label="Due"><Input type="date" name="due_at" /></Field><Field label="Payment reference"><Input name="payment_reference" /></Field><Field label="Notes" wide><Input name="invoice_notes" /></Field><button disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">Catat invoice</button>
        <div className="sm:col-span-2 space-y-1">{data.invoices.map((invoice) => <div key={text(invoice.id)} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700"><span>{text(invoice.invoice_number)} · {text(invoice.status)}</span><span className="flex items-center gap-3"><span>Rp {number(invoice.amount_idr).toLocaleString("id-ID")}</span>{invoice.status !== "paid" && invoice.status !== "void" && <button type="button" onClick={() => markInvoicePaid(text(invoice.id))} className="rounded bg-emerald-600 px-2 py-1 text-white">Mark paid</button>}</span></div>)}</div>
      </Panel></form>

      <Panel title="Customer health" description="Rules-based, explainable signal; AI tidak diperlukan.">
        <Metric label="Latest score" value={number(data.health?.score)} /><Metric label="Status" value={text(data.health?.status) || "not calculated"} />
        <div className="sm:col-span-2 text-sm text-zinc-600 dark:text-zinc-400">Reasons: {Array.isArray(data.health?.reasons) ? data.health?.reasons.join(" · ") : "Belum ada snapshot."}</div>
      </Panel>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 mb-5 text-sm text-zinc-500">{description}</p><div className="grid gap-4 sm:grid-cols-2">{children}</div></section>; }
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`space-y-1 text-sm ${wide ? "sm:col-span-2" : ""}`}><span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</span>{children}</label>; }
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />; }
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={3} {...props} className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />; }
function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: string[] }) { return <select {...props} className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950">{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><div className="text-xs uppercase text-zinc-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>; }
