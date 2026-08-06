import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CircleAlert,
  Megaphone,
  Milestone as MilestoneIcon,
  Sparkles,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listPortalNotifications,
  type PortalNotificationRow,
} from "@/lib/portal/notifications";
import { requirePortalSession } from "@/lib/portal/session";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database";

import {
  markAllPortalNotificationsRead,
  markPortalNotificationRead,
} from "../../actions";

export const metadata: Metadata = { title: "Portal — Notifications" };

type NotificationKind = Tables<"portal_notifications">["kind"];

const KIND_ICON: Record<
  NotificationKind,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  MILESTONE_UPDATE: MilestoneIcon,
  PROJECT_UPDATE: Sparkles,
  ANNOUNCEMENT: Megaphone,
  SYSTEM: CircleAlert,
};

const KIND_TONE: Record<NotificationKind, string> = {
  MILESTONE_UPDATE: "text-indigo-300 bg-indigo-500/10 border-indigo-400/30",
  PROJECT_UPDATE: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  ANNOUNCEMENT: "text-amber-300 bg-amber-500/10 border-amber-400/30",
  SYSTEM: "text-muted-foreground bg-white/5 border-white/10",
};

export default async function PortalNotificationsPage() {
  const session = await requirePortalSession();
  const [items, t, tKind, formatter] = await Promise.all([
    listPortalNotifications(session, { limit: 100 }),
    getTranslations("portal.notifications"),
    getTranslations("portal.notificationKind"),
    getFormatter(),
  ]);

  const unreadCount = items.filter((n) => n.read_at === null).length;

  async function ackOne(formData: FormData) {
    "use server";
    const id = formData.get("id");
    if (typeof id !== "string") return;
    await markPortalNotificationRead(id);
    revalidatePath("/portal/notifications");
    revalidatePath("/portal");
  }

  async function ackAll() {
    "use server";
    await markAllPortalNotificationsRead();
    revalidatePath("/portal/notifications");
    revalidatePath("/portal");
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("subtitle", { client: session.client.name })}
          </p>
        </div>
        {unreadCount > 0 ? (
          <form action={ackAll}>
            <Button type="submit" variant="outline" size="sm">
              <CheckCheck aria-hidden="true" className="size-4" />
              {t("markAllRead", { count: unreadCount })}
            </Button>
          </form>
        ) : null}
      </header>

      {items.length === 0 ? (
        <Card className="glass">
          <CardHeader className="flex flex-col items-center text-center py-14">
            <div className="grid size-12 place-items-center rounded-full bg-muted/40 text-muted-foreground">
              <BellOff aria-hidden="true" className="size-6" />
            </div>
            <CardTitle className="font-display mt-3">{t("empty")}</CardTitle>
            <CardDescription>{t("emptyBody")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="glass">
          <CardContent className="p-0">
            <ul className="divide-y divide-border/50">
              {items.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  kindLabel={tKind(n.kind)}
                  unreadLabel={t("unreadBadge")}
                  markReadLabel={t("markRead")}
                  formattedDate={formatter.dateTime(new Date(n.created_at), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  ackOne={ackOne}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  kindLabel,
  unreadLabel,
  markReadLabel,
  formattedDate,
  ackOne,
}: {
  notification: PortalNotificationRow;
  kindLabel: string;
  unreadLabel: string;
  markReadLabel: string;
  formattedDate: string;
  ackOne: (formData: FormData) => Promise<void>;
}) {
  const Icon = KIND_ICON[notification.kind] ?? Bell;
  const isUnread = notification.read_at === null;
  const body = (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 px-6 py-4 transition-colors",
        isUnread && "bg-indigo-500/[.04]",
      )}
    >
      <div
        className={cn(
          "grid size-9 place-items-center rounded-lg border shrink-0",
          KIND_TONE[notification.kind],
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "text-sm truncate",
              isUnread ? "font-medium text-foreground" : "text-foreground/90",
            )}
          >
            {notification.title}
          </p>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide border-border/60"
          >
            {kindLabel}
          </Badge>
          {isUnread ? (
            <span
              aria-label={unreadLabel}
              className="inline-block size-1.5 rounded-full bg-rose-500"
            />
          ) : null}
        </div>
        {notification.body ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {notification.body}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {formattedDate}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {isUnread ? (
          <form action={ackOne}>
            <input type="hidden" name="id" value={notification.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              aria-label={markReadLabel}
            >
              <Check aria-hidden="true" className="size-4" />
              <span className="sr-only sm:not-sr-only">{markReadLabel}</span>
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );

  if (notification.action_url) {
    return (
      <li>
        <Link
          href={notification.action_url}
          className="block hover:bg-muted/30 transition-colors"
        >
          {body}
        </Link>
      </li>
    );
  }
  return <li>{body}</li>;
}
