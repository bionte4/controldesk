import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getPortalUnreadCount } from "@/lib/portal/notifications";
import type { PortalSession } from "@/lib/portal/session";
import { cn } from "@/lib/utils";

/**
 * Portal topbar bell — server component that renders unread count.
 *
 * We intentionally keep this as a simple `<Link>` (no dropdown popover)
 * because the layout is a Server Component. Clicking navigates to
 * `/portal/notifications` for the full feed + mark-read affordance.
 */
export async function PortalBell({ session }: { session: PortalSession }) {
  const [count, t] = await Promise.all([
    getPortalUnreadCount(session),
    getTranslations("portal.notifications"),
  ]);
  const label = count > 0
    ? t("bellLabelWithCount", { count })
    : t("bellLabel");

  return (
    <Link
      href="/portal/notifications"
      aria-label={label}
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground",
        "hover:bg-muted/40 hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
      )}
    >
      <Bell aria-hidden="true" className="size-4" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-medium leading-none text-white tabular-nums"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </Link>
  );
}
