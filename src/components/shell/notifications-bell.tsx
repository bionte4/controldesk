"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Bell,
  BadgeCheck,
  BanknoteArrowDown,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileWarning,
  Handshake,
  Info,
  Upload,
  UserRoundCog,
  Undo2,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { id as idLocale } from "date-fns/locale/id";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import type { NotificationKind } from "@/types/database";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

const MAX_ITEMS = 20;

/**
 * Icon + tone per `notification_kind`. Kept in sync with
 * `supabase/migrations/0006_notifications_and_attachments.sql` and every
 * enum-extending migration below (0034 adds EMPLOYEE_CONTRACT_EXPIRING,
 * 0038 adds PROJECT_CONTRACT_EXPIRING).
 *
 * `tone` is a Tailwind foreground colour class applied to the icon; it
 * doubles as the accent used by the item's leading dot in unread state.
 */
const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  APPROVAL_REQUESTED: ClipboardCheck,
  APPROVAL_APPROVED: CheckCircle2,
  APPROVAL_REJECTED: XCircle,
  CASH_ADVANCE_DISBURSED: Wallet,
  CASH_ADVANCE_SETTLED: Wallet,
  PETTY_CASH_LOW_BALANCE: Wallet,
  HR_REQUEST_UPDATE: UserRoundCog,
  PROJECT_HANDOVER: Handshake,
  SLA_BREACH_WARNING: FileWarning,
  SYSTEM: Info,
  EMPLOYEE_CONTRACT_EXPIRING: UserRoundCog,
  PROJECT_CONTRACT_EXPIRING: CalendarClock,
  SETTLEMENT_DUE_SOON: CalendarClock,
  SETTLEMENT_OVERDUE: FileWarning,
  EXPENSE_DRAFT_STALE: CalendarClock,
  EXPENSE_INCURRED_STALE: FileWarning,
  EVALUATION_DUE: CalendarClock,
  EVALUATION_SUBMITTED: ClipboardList,
  EVALUATION_REVIEWED: ClipboardCheck,
  EVALUATION_RETURNED: Undo2,
  EVALUATION_APPROVED: CheckCircle2,
  EVALUATION_REJECTED: XCircle,
  EVALUATION_FINALIZED: BadgeCheck,
  UPK_DRAFT_CREATED: BanknoteArrowDown,
  UPK_SUBMITTED: BanknoteArrowDown,
  UPK_APPROVED: CheckCircle2,
  UPK_REJECTED: XCircle,
  UPK_PAID: BanknoteArrowDown,
  PAYROLL_STOP_REQUEST: FileWarning,
  MONTHLY_REPORT_SUBMITTED: ClipboardList,
  MONTHLY_REPORT_APPROVED: CheckCircle2,
  MONTHLY_REPORT_RETURNED: Undo2,
  MONTHLY_REPORT_REJECTED: XCircle,
  MONTHLY_REPORT_SENT_TO_CLIENT: ClipboardList,
  MONTHLY_REPORT_APPROVED_BY_CLIENT: CheckCircle2,
  MONTHLY_REPORT_REJECTED_BY_CLIENT: Undo2,
  MONTHLY_REPORT_BA_GENERATED: BadgeCheck,
  TIMESHEET_SUBMITTED: Clock,
  TIMESHEET_APPROVED: CheckCircle2,
  TIMESHEET_REJECTED: XCircle,
  BULK_IMPORT_COMPLETED: Upload,
};

const KIND_TONE: Record<NotificationKind, string> = {
  APPROVAL_REQUESTED: "text-indigo-500 dark:text-indigo-300",
  APPROVAL_APPROVED: "text-emerald-500 dark:text-emerald-300",
  APPROVAL_REJECTED: "text-rose-500 dark:text-rose-300",
  CASH_ADVANCE_DISBURSED: "text-amber-500 dark:text-amber-300",
  CASH_ADVANCE_SETTLED: "text-emerald-500 dark:text-emerald-300",
  PETTY_CASH_LOW_BALANCE: "text-rose-500 dark:text-rose-300",
  HR_REQUEST_UPDATE: "text-sky-500 dark:text-sky-300",
  PROJECT_HANDOVER: "text-indigo-500 dark:text-indigo-300",
  SLA_BREACH_WARNING: "text-rose-500 dark:text-rose-300",
  SYSTEM: "text-muted-foreground",
  EMPLOYEE_CONTRACT_EXPIRING: "text-amber-500 dark:text-amber-300",
  PROJECT_CONTRACT_EXPIRING: "text-amber-500 dark:text-amber-300",
  SETTLEMENT_DUE_SOON: "text-amber-500 dark:text-amber-300",
  SETTLEMENT_OVERDUE: "text-rose-500 dark:text-rose-300",
  EXPENSE_DRAFT_STALE: "text-amber-500 dark:text-amber-300",
  EXPENSE_INCURRED_STALE: "text-amber-500 dark:text-amber-300",
  EVALUATION_DUE: "text-amber-500 dark:text-amber-300",
  EVALUATION_SUBMITTED: "text-indigo-500 dark:text-indigo-300",
  EVALUATION_REVIEWED: "text-indigo-500 dark:text-indigo-300",
  EVALUATION_RETURNED: "text-amber-500 dark:text-amber-300",
  EVALUATION_APPROVED: "text-emerald-500 dark:text-emerald-300",
  EVALUATION_REJECTED: "text-rose-500 dark:text-rose-300",
  EVALUATION_FINALIZED: "text-emerald-500 dark:text-emerald-300",
  UPK_DRAFT_CREATED: "text-sky-500 dark:text-sky-300",
  UPK_SUBMITTED: "text-indigo-500 dark:text-indigo-300",
  UPK_APPROVED: "text-emerald-500 dark:text-emerald-300",
  UPK_REJECTED: "text-rose-500 dark:text-rose-300",
  UPK_PAID: "text-emerald-500 dark:text-emerald-300",
  PAYROLL_STOP_REQUEST: "text-rose-500 dark:text-rose-300",
  MONTHLY_REPORT_SUBMITTED: "text-indigo-500 dark:text-indigo-300",
  MONTHLY_REPORT_APPROVED: "text-emerald-500 dark:text-emerald-300",
  MONTHLY_REPORT_RETURNED: "text-amber-500 dark:text-amber-300",
  MONTHLY_REPORT_REJECTED: "text-rose-500 dark:text-rose-300",
  MONTHLY_REPORT_SENT_TO_CLIENT: "text-sky-500 dark:text-sky-300",
  MONTHLY_REPORT_APPROVED_BY_CLIENT: "text-emerald-500 dark:text-emerald-300",
  MONTHLY_REPORT_REJECTED_BY_CLIENT: "text-amber-500 dark:text-amber-300",
  MONTHLY_REPORT_BA_GENERATED: "text-emerald-500 dark:text-emerald-300",
  TIMESHEET_SUBMITTED: "text-indigo-500 dark:text-indigo-300",
  TIMESHEET_APPROVED: "text-emerald-500 dark:text-emerald-300",
  TIMESHEET_REJECTED: "text-rose-500 dark:text-rose-300",
  BULK_IMPORT_COMPLETED: "text-sky-500 dark:text-sky-300",
};

export function NotificationsBell({
  userId,
  tenantId,
  initial,
  locale,
}: {
  userId: string;
  tenantId: string;
  initial: NotificationItem[];
  locale: "id" | "en";
}) {
  const t = useTranslations("topbar.notifications");
  const router = useRouter();
  const [items, setItems] = React.useState<NotificationItem[]>(initial);
  const [pending, startTransition] = React.useTransition();

  const dateLocale = locale === "id" ? idLocale : enUS;

  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`tenant:${tenantId}:notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationItem;
          setItems((prev) => [row, ...prev].slice(0, MAX_ITEMS));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationItem;
          setItems((prev) =>
            prev.map((n) => (n.id === row.id ? { ...n, ...row } : n)),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, userId]);

  const unreadCount = items.filter((n) => !n.read_at).length;

  const onItemClick = (item: NotificationItem) => {
    if (!item.read_at) {
      startTransition(async () => {
        await markNotificationRead(item.id);
      });
      setItems((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      );
    }
    if (item.action_url) {
      router.push(item.action_url);
    }
  };

  const onMarkAll = () => {
    startTransition(async () => {
      await markAllNotificationsRead();
    });
    setItems((prev) =>
      prev.map((n) =>
        n.read_at ? n : { ...n, read_at: new Date().toISOString() },
      ),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative rounded-full"
            aria-label={t("label")}
          />
        }
      >
        <Bell className="size-4" />
        {unreadCount > 0 ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-rose-500 text-[10px] font-semibold text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t("label")}</span>
            {unreadCount > 0 ? (
              <Badge
                variant="outline"
                className="border-rose-400/30 bg-rose-500/10 text-rose-300"
              >
                {t("unread", { count: unreadCount })}
              </Badge>
            ) : null}
          </div>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onMarkAll}
              disabled={pending}
            >
              {t("markAllRead")}
            </Button>
          ) : null}
        </div>
        <Separator />
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium">{t("empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("emptyBody")}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-96">
            <ul className="divide-y divide-border/40">
              {items.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Bell;
                const tone = KIND_TONE[n.kind] ?? "text-muted-foreground";
                return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n)}
                    className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40 ${
                      n.read_at ? "opacity-70" : ""
                    }`}
                  >
                    <span
                      className="relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted/40"
                      aria-hidden
                    >
                      <Icon className={`size-3.5 ${tone}`} />
                      {!n.read_at ? (
                        <span
                          aria-hidden
                          className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background"
                        />
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight line-clamp-1">
                        {n.title}
                      </p>
                      {n.body ? (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {n.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                          locale: dateLocale,
                        })}
                      </p>
                    </div>
                  </button>
                </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
        <Separator />
        <Link
          href="/approvals"
          className="block px-3 py-2 text-center text-xs font-medium text-primary hover:underline"
        >
          {t("viewAll")}
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
