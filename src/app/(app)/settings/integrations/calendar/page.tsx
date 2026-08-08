import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  getCalendarConnectionStatus,
  getCalendarSyncCounters,
  getLastSyncTimestamp,
  listCalendarSyncEvents,
} from "@/lib/data/calendar-sync";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { CalendarSyncPanel } from "./calendar-sync-panel";

export const metadata: Metadata = { title: "Calendar sync" };

/**
 * Admin dashboard for the Google Calendar sync outbox
 * (migration 0039 + rules §17). RSC — fetches all data server-side
 * then hands it to the interactive `<CalendarSyncPanel>` client
 * component. Server-side revalidation from actions (retry / skip /
 * reconcile) keeps counters + rows in sync without a full refresh.
 *
 * Route is gated by both RLS (deny-all for non-admin) AND the PDP
 * check inside each server action. This page also checks role at
 * render time so a non-admin direct-URL hit gets 404 instead of an
 * empty screen.
 */
const ACCESS_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

export default async function CalendarSyncPage() {
  const employee = await requireCurrentEmployee();
  if (!ACCESS_ROLES.includes(employee.role as EmployeeRole)) notFound();

  const [t, connection, counters, initialEvents, lastSync] = await Promise.all([
    getTranslations("calendarSync"),
    getCalendarConnectionStatus(employee.tenant_id),
    getCalendarSyncCounters(),
    listCalendarSyncEvents({ limit: 100 }),
    getLastSyncTimestamp(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
          <CalendarClock className="size-5" aria-hidden />
        </div>
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
      </header>

      <CalendarSyncPanel
        connection={connection}
        counters={counters}
        initialEvents={initialEvents}
        lastSync={lastSync}
      />
    </div>
  );
}
