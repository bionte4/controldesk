import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Lock,
  LogOut,
  ShieldAlert,
  ShieldQuestion,
  TimerReset,
  Users,
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

import { requireCurrentEmployee } from "@/lib/auth/session";
import { authorize } from "@/lib/security/pdp";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { listClientPortalLoginEvents, listClientPortalUsers } from "./actions";
import { PortalUsersManager } from "./portal-users-manager";

export const metadata: Metadata = { title: "Client portal users" };

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  PENDING_ACTIVATION: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  DISABLED: "border-white/10 bg-white/5 text-muted-foreground",
  LOCKED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

const EVENT_LABEL_KEYS = [
  "SUCCESS",
  "FAILURE_UNKNOWN_USER",
  "FAILURE_BAD_PASSWORD",
  "FAILURE_LOCKED",
  "LOGOUT",
  "SESSION_EXPIRED",
] as const;

const EVENT_META: Record<
  string,
  {
    tone: string;
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  }
> = {
  SUCCESS: {
    tone: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
    icon: CheckCircle2,
  },
  FAILURE_UNKNOWN_USER: {
    tone: "border-rose-400/30 bg-rose-500/10 text-rose-300",
    icon: ShieldQuestion,
  },
  FAILURE_BAD_PASSWORD: {
    tone: "border-rose-400/30 bg-rose-500/10 text-rose-300",
    icon: ShieldAlert,
  },
  FAILURE_LOCKED: {
    tone: "border-amber-400/30 bg-amber-500/10 text-amber-300",
    icon: Lock,
  },
  LOGOUT: {
    tone: "border-white/10 bg-white/5 text-muted-foreground",
    icon: LogOut,
  },
  SESSION_EXPIRED: {
    tone: "border-white/10 bg-white/5 text-muted-foreground",
    icon: TimerReset,
  },
};

export default async function ClientPortalUsersPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const [employee, result, events, t, tStatus, tEvents, formatter] = await Promise.all([
    requireCurrentEmployee(),
    listClientPortalUsers(id),
    listClientPortalLoginEvents(id, { limit: 25 }),
    getTranslations("clients.portalUsers"),
    getTranslations("clients.portalUsers.status"),
    getTranslations("clients.portalUsers.events"),
    getFormatter(),
  ]);

  if (!result) notFound();
  const { client, users } = result;
  const loginEvents = events?.events ?? [];

  // Portal-user management is sensitive (Rules §28) — mirror PDP
  // `decideClientPortalUser('update')` client-side so the invite
  // button + row-level Reset/Toggle actions hide for viewers who
  // would be rejected server-side. Delegating to `authorize()`
  // keeps this gate in lock-step with the Server Action + RLS.
  const canManagePortalUsers =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "update",
      resource: "client_portal_user",
      attributes: { tenantId: employee.tenant_id },
    }).effect === "ALLOW";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href={`/clients/${id}`} />}
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Users className="size-6" />
          </div>
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {t("subtitle", { client: client.name })}
            </p>
          </div>
        </div>
        {canManagePortalUsers ? (
          <PortalUsersManager clientId={id} clientName={client.name} />
        ) : null}
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-base">
            {t("listTitle")}
          </CardTitle>
          <CardDescription>{t("listSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {t("cols.name")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {t("cols.email")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {t("cols.status")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {t("cols.lastLogin")}
                    </th>
                    <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">
                      {t("cols.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{u.full_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {u.email}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[u.status] ?? STATUS_TONE.DISABLED}
                        >
                          {tStatus(u.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        {u.last_login_at
                          ? formatter.dateTime(new Date(u.last_login_at), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canManagePortalUsers ? (
                          <PortalUsersManager
                            clientId={id}
                            clientName={client.name}
                            row={{
                              id: u.id,
                              email: u.email,
                              full_name: u.full_name,
                              status: u.status,
                            }}
                            rowMode
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-base">
            {tEvents("title")}
          </CardTitle>
          <CardDescription>{tEvents("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loginEvents.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {tEvents("empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table
                aria-label={tEvents("tableAriaLabel")}
                className="w-full text-sm"
              >
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {tEvents("cols.event")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {tEvents("cols.user")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {tEvents("cols.ip")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {tEvents("cols.userAgent")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {tEvents("cols.when")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loginEvents.map((e) => {
                    const meta =
                      EVENT_META[e.event] ?? EVENT_META.SESSION_EXPIRED;
                    const Icon = meta.icon;
                    const label = EVENT_LABEL_KEYS.includes(
                      e.event as (typeof EVENT_LABEL_KEYS)[number],
                    )
                      ? tEvents(
                          `kinds.${e.event as (typeof EVENT_LABEL_KEYS)[number]}`,
                        )
                      : e.event;
                    return (
                      <tr
                        key={e.id}
                        className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={`${meta.tone} inline-flex items-center gap-1`}
                          >
                            <Icon aria-hidden className="size-3" />
                            {label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {e.user_email ?? e.email_attempted ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                          {e.ip_address ? String(e.ip_address) : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                          {e.user_agent ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                          {formatter.dateTime(new Date(e.created_at), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
