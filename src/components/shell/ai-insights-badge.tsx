"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  countUnread,
  readLastSeen,
  writeLastSeen,
} from "@/lib/ai/last-seen";
import type { AiInsightKind, AiInsightSeverity } from "@/types/database";

const LAST_SEEN_EVENT = "cd:ai-insights-lastseen-updated";

export type InsightPreview = {
  id: string;
  kind: AiInsightKind;
  severity: AiInsightSeverity;
  headline: string;
  created_at: string;
};

/**
 * Topbar badge showing unread AI Insight count for privileged roles
 * (rules §15).
 *
 * The badge is:
 *   • Seeded server-side with the 20 most-recent insights for the tenant.
 *   • Kept live via a Supabase Realtime `INSERT` subscription filtered on
 *     `tenant_id` — new insights bump the counter without a full reload.
 *   • Silenced automatically when the user navigates to `/insights` (via
 *     `usePathname()` effect).
 *   • Tracked by localStorage per (tenant, user) so state is private to
 *     the device and never touches the server.
 */
export function AiInsightsBadge({
  tenantId,
  userId,
  initial,
}: {
  tenantId: string;
  userId: string;
  initial: InsightPreview[];
}) {
  const t = useTranslations("topbar.aiInsights");
  const pathname = usePathname();
  const [insights, setInsights] = React.useState<InsightPreview[]>(initial);

  const storage = React.useMemo<Storage | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);

  // Hydrate last-seen from localStorage via useSyncExternalStore so React
  // never has to schedule a setState-in-effect on mount. We subscribe to
  // both a custom in-tab event (fired below whenever we write) and the
  // browser `storage` event so other tabs stay in sync.
  const subscribe = React.useCallback((cb: () => void) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(LAST_SEEN_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(LAST_SEEN_EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  }, []);
  const getSnapshot = React.useCallback(
    () => readLastSeen(storage, { tenantId, userId }),
    [storage, tenantId, userId],
  );
  const lastSeen = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null,
  );

  // Realtime subscription — one channel per (tenant, user) to keep the
  // Supabase Realtime auth check tight.
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`tenant:${tenantId}:ai_insights:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ai_insights",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const row = payload.new as InsightPreview;
          setInsights((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev;
            return [row, ...prev].slice(0, 20);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, userId]);

  // Any navigation into /insights marks all currently-visible ones as
  // read. The effect only performs a side-effect (write + dispatch);
  // the resulting badge count re-renders through useSyncExternalStore.
  React.useEffect(() => {
    if (!pathname?.startsWith("/insights")) return;
    if (insights.length === 0) return;
    const newest = insights[0]?.created_at;
    if (!newest) return;
    writeLastSeen(storage, { tenantId, userId, iso: newest });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(LAST_SEEN_EVENT));
    }
  }, [pathname, insights, storage, tenantId, userId]);

  const unread = countUnread(insights, lastSeen);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative rounded-full"
      aria-label={t("ariaLabel", { count: unread })}
      nativeButton={false}
      render={<Link href="/insights" />}
    >
      <Sparkles className="size-4" />
      {unread > 0 ? (
        <Badge
          className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full px-1 py-0 text-[10px] font-semibold tabular-nums"
          variant="default"
          aria-hidden
        >
          {unread > 99 ? "99+" : unread}
        </Badge>
      ) : null}
    </Button>
  );
}
