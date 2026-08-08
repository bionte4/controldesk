import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserCog } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  deriveAdminUserStatus,
  loadAdminUsers,
  type AdminUserFilter,
  type AdminUserStatus,
} from "@/lib/data/admin-users";
import { formatInTz } from "@/lib/format/date";
import { CANONICAL_ROLE_LABELS, toCanonicalRole } from "@/lib/rbac/roles";
import type { AnyDbEmployeeRole, EmployeeRole } from "@/lib/rbac/roles";

import { InviteUserSheet } from "./invite-user-sheet";
import { UserRowActions } from "./user-row-actions";

export const metadata: Metadata = { title: "Users" };

/**
 * Only admins may see the users page. We intentionally serve a hard `notFound()`
 * to non-admin roles so the URL is unenumerable — mirrors the pattern used by
 * `/settings/lookups` and `/settings/secrets`.
 */
const READ_ROLES: readonly EmployeeRole[] = ["TENANT_ADMIN", "HR_ADMIN"];
const WRITE_ROLES: readonly EmployeeRole[] = ["TENANT_ADMIN"];

function isReadRole(role: string): boolean {
  return (READ_ROLES as readonly string[]).includes(role);
}

function isWriteRole(role: string): boolean {
  return (WRITE_ROLES as readonly string[]).includes(role);
}

const STATUS_TONE: Record<AdminUserStatus, string> = {
  ACTIVE: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  SUSPENDED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  INACTIVE: "border-slate-400/30 bg-slate-500/10 text-slate-300",
  PENDING: "border-amber-400/30 bg-amber-500/10 text-amber-300",
};

type SearchParams = {
  q?: string;
  status?: string;
};

function parseStatus(v: string | undefined): AdminUserFilter["status"] {
  if (v === "active" || v === "suspended" || v === "inactive") return v;
  return undefined;
}

/**
 * Presentation shell. All mutation UI (invite, change role, deactivate) is
 * intentionally omitted in Fase 1 — see docs/product/roles-and-permissions.md
 * for the phased plan. This page's sole job is to give admins visibility over
 * `auth.users` + `employees` correlation in the current tenant.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const employee = await requireCurrentEmployee();
  if (!isReadRole(employee.role as string)) {
    notFound();
  }

  const { q: rawQ, status: rawStatus } = await searchParams;
  const filter: AdminUserFilter = {
    q: rawQ?.trim() || undefined,
    status: parseStatus(rawStatus),
  };

  const [rows, t, tCommon] = await Promise.all([
    loadAdminUsers(filter),
    getTranslations("settings.users"),
    getTranslations("common"),
  ]);

  const total = rows.length;
  const currentUserId = employee.user_id;
  const canWrite = isWriteRole(employee.role as string);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {t("backToSettings")}
          </Link>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("subtitleV2")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/10 text-primary"
          >
            {t("totalCount", { count: total })}
          </Badge>
          {canWrite ? <InviteUserSheet /> : null}
        </div>
      </header>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3"
        aria-label={t("searchPlaceholder")}
      >
        <label className="flex flex-col gap-1">
          <span className="sr-only">{t("searchPlaceholder")}</span>
          <input
            type="search"
            name="q"
            defaultValue={rawQ ?? ""}
            placeholder={t("searchPlaceholder")}
            className="w-72 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-meta text-[10px]">
            {t("statusFilter.label")}
          </span>
          <select
            name="status"
            defaultValue={rawStatus ?? ""}
            className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <option value="">{t("statusFilter.all")}</option>
            <option value="active">{t("statusFilter.active")}</option>
            <option value="suspended">{t("statusFilter.suspended")}</option>
            <option value="inactive">{t("statusFilter.inactive")}</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg border border-border/60 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          {tCommon("search")}
        </button>
      </form>

      {total === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <UserCog className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("empty")}
            </CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>{t("columns.email")}</Th>
                    <Th>{t("columns.linkedEmployee")}</Th>
                    <Th>{t("columns.role")}</Th>
                    <Th>{t("columns.status")}</Th>
                    <Th>{t("columns.lastLogin")}</Th>
                    <Th>{t("columns.createdAt")}</Th>
                    {canWrite ? (
                      <Th className="text-right">{t("columns.actions")}</Th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const status = deriveAdminUserStatus(r);
                    const isSelf = r.user_id === currentUserId;
                    const roleLabel = r.employee_role
                      ? CANONICAL_ROLE_LABELS[
                          toCanonicalRole(r.employee_role as AnyDbEmployeeRole)
                        ]
                      : t("noRole");
                    return (
                      <tr
                        key={r.user_id}
                        className="border-t border-border/50 transition-colors hover:bg-muted/30"
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs">
                              {r.email ?? "—"}
                            </span>
                            {isSelf ? (
                              <Badge
                                variant="outline"
                                className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                              >
                                {t("youBadge")}
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.employee_name ?? (
                            <span className="text-muted-foreground">
                              {t("noLinkedEmployee")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.employee_role ? (
                            <Badge
                              variant="outline"
                              className="border-slate-400/30 bg-slate-500/10 text-slate-200"
                            >
                              {roleLabel}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">
                              {roleLabel}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={STATUS_TONE[status]}
                          >
                            {t(`status.${status}`)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {r.last_sign_in_at
                            ? formatInTz(r.last_sign_in_at, "dd MMM yyyy HH:mm")
                            : t("neverSignedIn")}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {r.auth_created_at
                            ? formatInTz(r.auth_created_at, "dd MMM yyyy")
                            : "—"}
                        </td>
                        {canWrite ? (
                          <td className="px-4 py-3 text-right">
                            <UserRowActions
                              userId={r.user_id}
                              employeeId={r.employee_id}
                              currentRole={
                                r.employee_role
                                  ? toCanonicalRole(
                                      r.employee_role as AnyDbEmployeeRole,
                                    )
                                  : null
                              }
                              isActive={r.employee_is_active !== false}
                              targetEmail={r.email}
                              isSelf={isSelf}
                            />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={[
        "label-meta px-4 py-2 text-[10px] font-medium text-muted-foreground",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      {children}
    </th>
  );
}
