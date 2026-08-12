import { AlertTriangle, Clock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { computeTrialStatus } from "@/lib/ops/tenant-signup";

/**
 * In-app trial banner (Fase 6, migration 0078).
 *
 * Renders a compact banner at the top of the app shell when the
 * current tenant is on `plan='trial'`. Shows:
 *   • Days remaining (Aktif state).
 *   • Warning styling when < 3 days (Aktif but urgent).
 *   • Expired notice when past `trial_ends_at` (soft — the app
 *     still works; enforcement is manual via /super-admin until
 *     billing lands).
 *
 * NULL when the tenant isn't on a trial or the row doesn't have
 * `trial_ends_at` set (existing tenants, ops-provisioned tenants
 * that skipped the trial default). This is a Server Component so
 * the query is deduped by React.cache() across the layout tree.
 */
export async function TrialBanner({ tenantId }: { tenantId: string }) {
  if (!tenantId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("plan, trial_ends_at, name")
    .eq("id", tenantId)
    .maybeSingle();
  if (!data || data.plan !== "trial") return null;

  const status = computeTrialStatus(data.trial_ends_at);
  if (status.kind === "not_on_trial") return null;

  if (status.kind === "active") {
    const urgent = status.daysRemaining <= 3;
    const dateStr = status.endsAt.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    return (
      <div
        role="status"
        className={`flex items-center justify-between gap-3 px-4 py-2 text-xs sm:text-sm ${
          urgent
            ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
            : "bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200"
        }`}
      >
        <div className="flex items-center gap-2">
          {urgent ? (
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
          ) : (
            <Clock className="size-4 shrink-0" aria-hidden />
          )}
          <span>
            Uji coba{" "}
            <strong>
              {status.daysRemaining} hari lagi
            </strong>{" "}
            (berakhir {dateStr}). Hubungi{" "}
            <a
              href="mailto:sales@controldesk.app"
              className="underline hover:no-underline"
            >
              sales@controldesk.app
            </a>{" "}
            untuk lanjut ke paket berbayar.
          </span>
        </div>
      </div>
    );
  }

  // Expired — still show but louder + more instructional.
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-rose-100 px-4 py-2 text-xs text-rose-900 dark:bg-rose-950/50 dark:text-rose-200 sm:text-sm"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span>
          Uji coba <strong>berakhir {status.daysSince} hari lalu</strong>.
          Workspace masih bisa diakses selama grace period, namun akan
          di-suspend oleh tim platform bila tidak dikonversi ke paket
          berbayar.{" "}
          <a
            href="mailto:sales@controldesk.app"
            className="underline hover:no-underline"
          >
            Hubungi sales
          </a>
          .
        </span>
      </div>
    </div>
  );
}
