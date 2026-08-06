"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to every table that surfaces in the unified approvals inbox
 * and forces a soft router refresh when relevant rows change. Because the
 * page is a Server Component, `router.refresh()` re-runs the loader queries
 * and streams down the new HTML while preserving scroll + form state.
 *
 * Rules §20 — Realtime channel `tenant:{id}:approvals` semantics.
 */
export function ApprovalsRealtime({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const refreshRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    refreshRef.current = () => router.refresh();
  }, [router]);

  React.useEffect(() => {
    const supabase = createClient();

    // Coalesce bursts of changes into a single refresh every 500ms.
    let pending = false;
    const trigger = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        refreshRef.current();
      }, 500);
    };

    const channel = supabase
      .channel(`tenant:${tenantId}:approvals`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_expenses",
          filter: `tenant_id=eq.${tenantId}`,
        },
        trigger,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cash_advances",
          filter: `tenant_id=eq.${tenantId}`,
        },
        trigger,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hr_requests",
          filter: `tenant_id=eq.${tenantId}`,
        },
        trigger,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "petty_cash_replenishments",
          filter: `tenant_id=eq.${tenantId}`,
        },
        trigger,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "budgets",
          filter: `tenant_id=eq.${tenantId}`,
        },
        trigger,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "budget_requests",
          filter: `tenant_id=eq.${tenantId}`,
        },
        trigger,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "timesheet_weeks",
          filter: `tenant_id=eq.${tenantId}`,
        },
        trigger,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  return null;
}
