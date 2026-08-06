"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
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
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n)}
                    className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40 ${
                      n.read_at ? "opacity-70" : ""
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                        n.read_at ? "bg-transparent" : "bg-primary"
                      }`}
                    />
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
              ))}
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
