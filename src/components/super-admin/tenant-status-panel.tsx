"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setTenantStatusAction } from "@/app/(super-admin)/super-admin/actions";

type Props = {
  tenantId: string;
  tenantSlug: string;
  status: "active" | "suspended" | "terminated";
};

export function TenantStatusPanel({ tenantId, tenantSlug, status }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (status === "terminated") {
    // Terminated tenants cannot be reactivated from UI. Point operator
    // to the runbook for the DR-level playbook.
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900 dark:bg-rose-950/40">
        <h2 className="text-lg font-semibold text-rose-800 dark:text-rose-200">
          Tenant di-terminate
        </h2>
        <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
          Tenant ini berada di state <code>terminated</code>. Untuk
          restore, ikuti runbook{" "}
          <a
            href="https://github.com/bontiharyanto/controldesk/blob/main/docs/ops/tenant-provisioning.md#rollback"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            docs/ops/tenant-provisioning.md#rollback
          </a>{" "}
          (butuh akses DB langsung + audit trail archival).
        </p>
      </section>
    );
  }

  const isActive = status === "active";
  const targetStatus = isActive ? "suspended" : "active";
  const buttonLabel = isActive ? "Suspend tenant" : "Reactivate tenant";

  const handleClick = () => {
    if (isActive) {
      // Require confirm before suspending — this immediately locks all
      // users out of the tenant on their next request.
      if (
        !window.confirm(
          `Yakin mau suspend "${tenantSlug}"? Semua user tenant ini akan langsung diblokir oleh proxy pada request berikutnya.`,
        )
      ) {
        return;
      }
    }
    setError(null);
    startTransition(async () => {
      const res = await setTenantStatusAction({
        tenant_id: tenantId,
        status: targetStatus,
        reason: reason.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setReason("");
      router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tenant lifecycle</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Current status:{" "}
            <StatusBadge status={status} />
            . Suspending memblokir semua request di proxy — kredensial user
            tidak dihapus.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:min-w-[280px]">
          {isActive && (
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Alasan suspend (opsional, audit)"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              maxLength={500}
            />
          )}
          <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-60 ${
              isActive
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {isPending ? "Memproses…" : buttonLabel}
          </button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          {error}
        </p>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    suspended:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    terminated:
      "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? "bg-zinc-100 text-zinc-800"
      }`}
    >
      {status}
    </span>
  );
}
