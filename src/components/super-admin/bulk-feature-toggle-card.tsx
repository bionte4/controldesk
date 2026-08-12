"use client";

import { useMemo, useState, useTransition } from "react";

import { bulkToggleFeatureFlagAction } from "@/app/(super-admin)/super-admin/actions";

type TenantChoice = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

type Stats = { on: number; off: number; defaultCount: number };

type Props = {
  featureKey: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  totalTenants: number;
  activeTenants: number;
  stats: Stats;
  allTenantSlugs: TenantChoice[];
};

type Mode = "all" | "active" | "tenant_ids";

/**
 * Per-feature bulk toggle card (Fase 6.2). Client component so the
 * operator can pick mode + preview affected count + confirm before
 * firing the action. Confirmation is INTENTIONALLY required — a
 * mis-clicked "ON for all" on `google_calendar_sync` would enable
 * a broken feature for every tenant.
 */
export function BulkFeatureToggleCard(props: Props) {
  const [mode, setMode] = useState<Mode>("active");
  const [enable, setEnable] = useState<boolean>(!props.defaultEnabled);
  const [selectedSlugsRaw, setSelectedSlugsRaw] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: "ok"; affected: number; bulkRunId: string }
    | { kind: "err"; reason: string }
    | null
  >(null);

  const selectedTenants = useMemo(() => {
    if (mode !== "tenant_ids") return [];
    const rawSlugs = selectedSlugsRaw
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return props.allTenantSlugs.filter((t) => rawSlugs.includes(t.slug));
  }, [mode, selectedSlugsRaw, props.allTenantSlugs]);

  const affectedCount =
    mode === "all"
      ? props.totalTenants
      : mode === "active"
        ? props.activeTenants
        : selectedTenants.length;

  const handleSubmit = () => {
    setResult(null);
    startTransition(async () => {
      const res = await bulkToggleFeatureFlagAction({
        feature_key: props.featureKey,
        enabled: enable,
        mode,
        tenant_ids:
          mode === "tenant_ids"
            ? selectedTenants.map((t) => t.id)
            : undefined,
        notes: notes.trim() || undefined,
      });
      if (res.ok) {
        setResult({
          kind: "ok",
          affected: res.data.affected_tenants,
          bulkRunId: res.data.bulk_run_id,
        });
        setConfirmOpen(false);
      } else {
        setResult({ kind: "err", reason: res.reason });
      }
    });
  };

  const effectiveOnPct =
    props.totalTenants > 0
      ? Math.round(
          ((props.stats.on +
            (props.defaultEnabled ? props.stats.defaultCount : 0)) /
            props.totalTenants) *
            100,
        )
      : 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              {props.label}
            </h3>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {props.featureKey}
            </code>
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {props.description}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {effectiveOnPct}%
          </div>
          <div className="text-xs text-zinc-500">effective ON</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <StatChip
          label="Explicit ON"
          value={props.stats.on}
          tone="emerald"
        />
        <StatChip
          label="Explicit OFF"
          value={props.stats.off}
          tone="rose"
        />
        <StatChip
          label={`Default (${props.defaultEnabled ? "ON" : "OFF"})`}
          value={props.stats.defaultCount}
          tone="zinc"
        />
      </div>

      {result?.kind === "ok" && (
        <div className="mt-4 rounded-md bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          ✓ {result.affected} tenant di-update. bulk_run_id:{" "}
          <code>{result.bulkRunId}</code>
        </div>
      )}
      {result?.kind === "err" && (
        <div className="mt-4 rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          ✕ {result.reason}
        </div>
      )}

      {!confirmOpen ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs">
            <div className="mb-1 text-zinc-600 dark:text-zinc-400">Mode</div>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="active">
                Semua tenant aktif ({props.activeTenants})
              </option>
              <option value="all">
                Semua tenant termasuk suspended ({props.totalTenants})
              </option>
              <option value="tenant_ids">Canary: pilih slug spesifik</option>
            </select>
          </label>
          <label className="text-xs">
            <div className="mb-1 text-zinc-600 dark:text-zinc-400">Aksi</div>
            <select
              value={enable ? "on" : "off"}
              onChange={(e) => setEnable(e.target.value === "on")}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="on">Set ke ON</option>
              <option value="off">Set ke OFF</option>
            </select>
          </label>
          <div className="self-end">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={mode === "tenant_ids" && selectedTenants.length === 0}
              className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 sm:w-auto"
            >
              Terapkan…
            </button>
          </div>

          {mode === "tenant_ids" && (
            <div className="sm:col-span-3">
              <label className="text-xs">
                <div className="mb-1 text-zinc-600 dark:text-zinc-400">
                  Slug tenant (comma / spasi)
                </div>
                <input
                  value={selectedSlugsRaw}
                  onChange={(e) => setSelectedSlugsRaw(e.target.value)}
                  placeholder="acme, kontraktor-jaya, pt-alpha"
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <div className="mt-1 text-xs text-zinc-500">
                Match: <strong>{selectedTenants.length}</strong> tenant
                {selectedTenants.length > 0 && (
                  <>
                    {" "}
                    ({selectedTenants
                      .map((t) => t.slug)
                      .slice(0, 5)
                      .join(", ")}
                    {selectedTenants.length > 5 && "…"})
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Konfirmasi bulk toggle
          </div>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Set <code>{props.featureKey}</code> ke{" "}
            <strong>{enable ? "ON" : "OFF"}</strong> untuk{" "}
            <strong>{affectedCount}</strong> tenant. Efek langsung — tidak
            ada rollback otomatis. Setiap tenant tercatat sebagai row
            audit terpisah.
          </p>
          <label className="mt-3 block text-xs">
            <div className="mb-1 text-amber-900 dark:text-amber-200">
              Catatan audit (opsional)
            </div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: canary rollout untuk tenant tier-1"
              className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 dark:border-amber-800 dark:bg-zinc-950"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || affectedCount === 0}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {isPending
                ? "Menerapkan…"
                : `Konfirmasi (${affectedCount} tenant)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "zinc";
}) {
  const toneCls = {
    emerald:
      "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    rose:
      "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  }[tone];
  return (
    <div className={`flex items-center justify-between rounded-md px-2.5 py-1.5 ${toneCls}`}>
      <span className="text-[10px] uppercase tracking-wide opacity-80">
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
