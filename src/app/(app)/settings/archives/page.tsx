import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type {
  DataArchiveSource,
  DataArchiveStatus,
} from "@/types/database";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { ArchiveRowActions } from "./archive-row-actions";

export const metadata: Metadata = { title: "Cold-Storage Archives" };

const READ_ROLES: readonly EmployeeRole[] = ["TENANT_ADMIN", "GENERAL_MANAGER"];

function isReadRole(role: string): boolean {
  return (READ_ROLES as readonly string[]).includes(role);
}

type ArchiveRow = {
  id: string;
  source_table: DataArchiveSource;
  batch_start: string;
  batch_end: string;
  row_count: number;
  bytes_written: number;
  status: DataArchiveStatus;
  storage_path: string;
  checksum_sha256: string;
  error_message: string | null;
  created_at: string;
  purged_at: string | null;
  purged_row_count: number | null;
  restore_verified_at: string | null;
};

const STATUS_TONE: Record<DataArchiveStatus, string> = {
  PENDING: "border-slate-400/30 bg-slate-500/10 text-slate-200",
  ARCHIVED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  RESTORED: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  PURGED: "border-zinc-400/30 bg-zinc-500/10 text-zinc-300",
  FAILED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

const SOURCE_LABEL: Record<DataArchiveSource, string> = {
  security_audit_logs: "Audit Logs",
  cash_advance_settlements: "CA Settlements",
  petty_cash_vouchers: "Petty Cash Vouchers",
  project_expenses: "Project Expenses",
  cash_advances: "Cash Advances",
};

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function loadArchives(tenantId: string): Promise<ArchiveRow[]> {
  // Uses service_role because the page enforces RBAC upstream; the RLS
  // policy on `data_archives` restricts to admins already, but going
  // through service_role avoids a double round-trip when populating the
  // full registry view.
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("data_archives")
    .select(
      "id, source_table, batch_start, batch_end, row_count, bytes_written, status, storage_path, checksum_sha256, error_message, created_at, purged_at, purged_row_count, restore_verified_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as ArchiveRow[];
}

export default async function ArchivesPage() {
  const employee = await requireCurrentEmployee();
  if (!isReadRole(employee.role)) notFound();

  const [rows, t] = await Promise.all([
    loadArchives(employee.tenant_id),
    getTranslations("settings.archives"),
  ]);

  const canVerify = employee.role === "TENANT_ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t("description")}
            </p>
          </div>
        </div>
      </header>

      <Card className="glass">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Archive className="size-4" /> {t("registryTitle")}
            </CardTitle>
            <CardDescription>
              {t("registryDescription", { count: rows.length })}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
              {t("empty")}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table
                aria-label={t("tableAriaLabel")}
                className="w-full text-left text-sm tabular-nums"
              >
                <caption className="sr-only">{t("tableAriaLabel")}</caption>
                <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="p-3">{t("colSource")}</th>
                    <th scope="col" className="p-3">{t("colYear")}</th>
                    <th scope="col" className="p-3">{t("colRows")}</th>
                    <th scope="col" className="p-3">{t("colBytes")}</th>
                    <th scope="col" className="p-3">{t("colStatus")}</th>
                    <th scope="col" className="p-3">{t("colChecksum")}</th>
                    <th scope="col" className="p-3">{t("colVerified")}</th>
                    <th scope="col" className="p-3 text-right">
                      {t("colActions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const batchYear = new Date(r.batch_start).getUTCFullYear();
                    const checksumShort = r.checksum_sha256
                      ? `${r.checksum_sha256.slice(0, 8)}…${r.checksum_sha256.slice(-4)}`
                      : "—";
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-border/40 align-top"
                      >
                        <td className="p-3">
                          <div className="font-medium">
                            {SOURCE_LABEL[r.source_table]}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground break-all">
                            {r.storage_path}
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {batchYear}
                        </td>
                        <td className="p-3">
                          {r.row_count.toLocaleString()}
                          {r.purged_row_count !== null ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {t("purgedRowCount", {
                                count: r.purged_row_count,
                              })}
                            </span>
                          ) : null}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {humanBytes(r.bytes_written)}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={STATUS_TONE[r.status]}
                          >
                            {r.status}
                          </Badge>
                          {r.status === "FAILED" && r.error_message ? (
                            <p className="mt-1 max-w-xs break-words text-[11px] text-rose-400">
                              {r.error_message}
                            </p>
                          ) : null}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-muted-foreground">
                          {checksumShort}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {r.restore_verified_at
                            ? formatInTz(r.restore_verified_at, "dd MMM yyyy HH:mm")
                            : "—"}
                          {r.purged_at ? (
                            <p className="mt-0.5 text-[11px]">
                              {t("purgedAt", {
                                date: formatInTz(r.purged_at, "dd MMM yyyy"),
                              })}
                            </p>
                          ) : null}
                        </td>
                        <td className="p-3">
                          <ArchiveRowActions
                            registryId={r.id}
                            status={r.status}
                            canVerify={canVerify}
                          />
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
