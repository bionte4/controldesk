import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Upload } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { getImportAdapter } from "@/lib/import/adapters";
import { IMPORT_RESOURCES, type ImportResource } from "@/lib/import/types";
import type { EmployeeRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";

import { BulkImportWizard } from "./wizard";

export const metadata: Metadata = { title: "Bulk import" };

const ACCESS_ROLES: readonly EmployeeRole[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "LEAD_FINANCE",
];

// Card copy per resource — kept as ordered pairs so we can iterate.
const RESOURCE_ORDER: readonly ImportResource[] = IMPORT_RESOURCES;

async function loadRecentJobs(tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_jobs")
    .select(
      "id, resource, status, file_name, row_count, valid_row_count, invalid_row_count, inserted_count, updated_count, created_at, committed_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []) as Array<{
    id: string;
    resource: ImportResource;
    status: "DRY_RUN" | "COMMITTED" | "FAILED";
    file_name: string;
    row_count: number;
    valid_row_count: number;
    invalid_row_count: number;
    inserted_count: number;
    updated_count: number;
    created_at: string;
    committed_at: string | null;
  }>;
}

export default async function BulkImportPage() {
  const employee = await requireCurrentEmployee();
  if (!(ACCESS_ROLES as readonly string[]).includes(employee.role as string)) {
    notFound();
  }

  const [t, recentJobs] = await Promise.all([
    getTranslations("bulkImport"),
    loadRecentJobs(employee.tenant_id),
  ]);

  const resourceSummaries = RESOURCE_ORDER.map((r) => {
    const adapter = getImportAdapter(r);
    return {
      resource: r,
      label: t(`resources.${r}.label`),
      subtitle: t(`resources.${r}.subtitle`),
      columns: adapter.columns.map((c) => ({
        key: c.key,
        label: c.label,
        type: c.type,
        required: c.required,
        example: c.example,
        enumValues: c.enumValues ? [...c.enumValues] : undefined,
        refHint: c.refHint,
      })),
      grid: Boolean(adapter.grid),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="label-meta">{t("kicker")}</p>
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
            <Upload className="size-5" />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          {t("subtitle")}
        </p>
      </header>

      <BulkImportWizard
        resources={resourceSummaries}
        labels={{
          rowCap: t("meta.rowCap"),
          fileCap: t("meta.fileCap"),
          chooseResource: t("panels.chooseResource"),
          oneRowRecord: t("panels.oneRowRecord"),
          oneCsvGrid: t("panels.oneCsvGrid"),
          downloadTemplate: t("actions.downloadTemplate"),
          downloadTemplateXlsx: t("actions.downloadTemplateXlsx"),
          downloadTemplateCsv: t("actions.downloadTemplateCsv"),
          chooseFile: t("actions.chooseFile"),
          replaceFile: t("actions.replaceFile"),
          dryRun: t("actions.dryRun"),
          runImport: t("actions.runImport"),
          running: t("actions.running"),
          columnHeader: t("panels.columnHeader"),
          column_col: t("panels.column_col"),
          column_label: t("panels.column_label"),
          column_type: t("panels.column_type"),
          column_required: t("panels.column_required"),
          column_example: t("panels.column_example"),
          required_yes: t("panels.required_yes"),
          required_no: t("panels.required_no"),
          previewTitle: t("preview.title"),
          previewValid: t("preview.valid"),
          previewInvalid: t("preview.invalid"),
          previewInsert: t("preview.insert"),
          previewUpdate: t("preview.update"),
          previewErrors: t("preview.errors"),
          previewSample: t("preview.sample"),
          resultOk: t("result.ok"),
          resultFailed: t("result.failed"),
          resultInserted: t("result.inserted"),
          resultUpdated: t("result.updated"),
          successToast: t("result.successToast"),
          errorToast: t("result.errorToast"),
          historyTitle: t("history.title"),
          historyEmpty: t("history.empty"),
          historyResource: t("history.resource"),
          historyFile: t("history.file"),
          historyRows: t("history.rows"),
          historyStatus: t("history.status"),
          historyWhen: t("history.when"),
          statusDryRun: t("history.status_DRY_RUN"),
          statusCommitted: t("history.status_COMMITTED"),
          statusFailed: t("history.status_FAILED"),
        }}
        recentJobs={recentJobs.map((j) => ({
          ...j,
          resource_label: t(`resources.${j.resource}.label`),
        }))}
      />

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">{t("info.governanceTitle")}</CardTitle>
          <CardDescription>{t("info.governanceBody")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          <div>
            <strong className="text-foreground">{t("info.atomicTitle")}</strong>
            <p>{t("info.atomicBody")}</p>
          </div>
          <div>
            <strong className="text-foreground">{t("info.retainTitle")}</strong>
            <p>{t("info.retainBody")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
