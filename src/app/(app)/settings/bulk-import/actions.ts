"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { getImportAdapter } from "@/lib/import/adapters";
import {
  BulkImportParseError,
  parseImportBuffer,
} from "@/lib/import/parsers";
import { loadResolverMaps } from "@/lib/import/resolver";
import {
  IMPORT_RESOURCES,
  isImportResource,
  type ImportResource,
} from "@/lib/import/types";
import { notifyUser } from "@/lib/notifications/service";
import { recordAudit } from "@/lib/security/audit";
import { authorize } from "@/lib/security/pdp";
import { RateLimitPresets, limit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

// Runtime returns from the server actions. Kept as plain objects so
// the client can render preview / commit dialogs without extra
// unwrap logic (aligns with the ActionResult contract in rules §17).
export type DryRunResult =
  | {
      ok: true;
      job_id: string;
      resource: ImportResource;
      row_count: number;
      valid_count: number;
      invalid_count: number;
      inserted_preview: number; // how many rows would insert
      updated_preview: number; // how many rows would update
      errors: {
        row_number: number;
        field: string | null;
        message: string;
        raw?: string | null;
      }[];
      columns: unknown;
      sample_valid_rows: unknown[];
    }
  | { ok: false; reason: string; code: string };

export type CommitResult =
  | {
      ok: true;
      job_id: string;
      resource: ImportResource;
      inserted: number;
      updated: number;
    }
  | { ok: false; reason: string; code: string };

async function readFormFile(fd: FormData): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
}> {
  const file = fd.get("file");
  if (!file || typeof (file as File).arrayBuffer !== "function") {
    throw new BulkImportParseError("No file uploaded.");
  }
  const f = file as File;
  const ab = await f.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    filename: f.name,
    mime: f.type,
  };
}

function toResource(value: unknown): ImportResource {
  if (typeof value !== "string" || !isImportResource(value)) {
    throw new Error(
      `Invalid resource. Expected one of: ${IMPORT_RESOURCES.join(", ")}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// DRY RUN — parse + validate + preview counts, no commit.
// ---------------------------------------------------------------------------
export async function dryRunImportAction(fd: FormData): Promise<DryRunResult> {
  const employee = await requireCurrentEmployee();

  const authz = authorize({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: employee.role as unknown as Parameters<
        typeof authorize
      >[0]["actor"]["role"],
      tenantId: employee.tenant_id,
    },
    action: "bulk_import",
    resource: "import_job",
    attributes: { tenantId: employee.tenant_id },
  });
  if (authz.effect === "DENY") {
    return { ok: false, code: "FORBIDDEN", reason: authz.reason };
  }

  const rl = await limit(
    `bulk-import-dry:${employee.tenant_id}:${employee.id}`,
    RateLimitPresets.bulkImportDryRun(),
  );
  if (!rl.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      reason: `Too many dry-run attempts. Try again in ${Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))}s.`,
    };
  }

  try {
    const resource = toResource(fd.get("resource"));
    const { buffer, filename, mime } = await readFormFile(fd);
    const parsed = await parseImportBuffer({ buffer, filename, mime });

    const supabase = await createClient();
    const adapter = getImportAdapter(resource);
    const maps = await loadResolverMaps(
      supabase,
      employee.tenant_id,
      adapter.needs,
    );
    const validation = await adapter.validate({
      rows: parsed.rows,
      maps,
      tenantId: employee.tenant_id,
    });

    // Compute insert-vs-update preview by peeking at the natural key
    // maps. Best-effort — the actual commit re-checks.
    let insertedPreview = 0;
    let updatedPreview = 0;
    for (const v of validation.valid) {
      if (!v.key) {
        insertedPreview++;
        continue;
      }
      const exists = existsForResource(resource, v.key, maps);
      if (exists) updatedPreview++;
      else insertedPreview++;
    }

    // Persist the dry-run job for postmortem.
    const { data: job, error: jobErr } = await supabase
      .from("import_jobs")
      .insert({
        tenant_id: employee.tenant_id,
        resource,
        status: "DRY_RUN",
        file_name: filename,
        file_size_bytes: buffer.byteLength,
        row_count: parsed.rows.length,
        valid_row_count: validation.valid.length,
        invalid_row_count: validation.errors.length,
        inserted_count: insertedPreview,
        updated_count: updatedPreview,
        errors: validation.errors as unknown as Json,
        stats: {
          headers: parsed.headers,
          format: parsed.format,
        },
        created_by: employee.id,
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      return {
        ok: false,
        code: "INTERNAL",
        reason: jobErr?.message ?? "Failed to persist dry-run job.",
      };
    }

    return {
      ok: true,
      job_id: (job as { id: string }).id,
      resource,
      row_count: parsed.rows.length,
      valid_count: validation.valid.length,
      invalid_count: validation.errors.length,
      inserted_preview: insertedPreview,
      updated_preview: updatedPreview,
      errors: validation.errors.slice(0, 200), // cap payload
      columns: adapter.columns,
      sample_valid_rows: validation.valid.slice(0, 5).map((v) => v.commit),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof BulkImportParseError) {
      return { ok: false, code: "PARSE_ERROR", reason: msg };
    }
    return { ok: false, code: "INTERNAL", reason: msg };
  }
}

function existsForResource(
  resource: ImportResource,
  key: string,
  maps: Awaited<ReturnType<typeof loadResolverMaps>>,
): boolean {
  switch (resource) {
    case "EMPLOYEE":
      return maps.employeeByEmail.has(key);
    case "CLIENT":
      return maps.clientByKey.has(key);
    case "PROJECT":
      return maps.projectByCode.has(key);
    case "BUDGET_LINE":
      // Grid — key = "PROJECT:YEAR:COA". We can't know from maps alone
      // whether the line exists, so treat as INSERT preview. Actual
      // committer differentiates properly.
      return false;
  }
}

// ---------------------------------------------------------------------------
// COMMIT — re-validate then insert/update. Rolls back atomically if
// any row commits fail via error propagation.
// ---------------------------------------------------------------------------
export async function runImportAction(fd: FormData): Promise<CommitResult> {
  const employee = await requireCurrentEmployee();

  const authz = authorize({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: employee.role as unknown as Parameters<
        typeof authorize
      >[0]["actor"]["role"],
      tenantId: employee.tenant_id,
    },
    action: "bulk_import",
    resource: "import_job",
    attributes: { tenantId: employee.tenant_id },
  });
  if (authz.effect === "DENY") {
    return { ok: false, code: "FORBIDDEN", reason: authz.reason };
  }

  const rl = await limit(
    `bulk-import:${employee.tenant_id}:${employee.id}`,
    RateLimitPresets.bulkImport(),
  );
  if (!rl.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      reason: `Too many bulk imports. Try again in ${Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))}s.`,
    };
  }

  const supabase = await createClient();

  try {
    const resource = toResource(fd.get("resource"));
    const { buffer, filename, mime } = await readFormFile(fd);
    const parsed = await parseImportBuffer({ buffer, filename, mime });

    const adapter = getImportAdapter(resource);
    const maps = await loadResolverMaps(
      supabase,
      employee.tenant_id,
      adapter.needs,
    );
    const validation = await adapter.validate({
      rows: parsed.rows,
      maps,
      tenantId: employee.tenant_id,
    });

    // All-or-nothing: any validation error blocks the whole batch.
    // Rules §17 requires ActionResult errors, so we return `ok:false`
    // with a summary — the UI can pull the error report via the
    // stored dry-run job if the user wants details.
    if (validation.errors.length > 0) {
      return {
        ok: false,
        code: "VALIDATION",
        reason: `File has ${validation.errors.length} validation error${validation.errors.length === 1 ? "" : "s"}. Fix them and run dry-run again.`,
      };
    }
    if (validation.valid.length === 0) {
      return {
        ok: false,
        code: "EMPTY",
        reason: "No valid rows to import.",
      };
    }

    // Insert the job row first with status=DRY_RUN as a lock, then
    // flip to COMMITTED after the committer returns. If the committer
    // throws, we mark FAILED with the reason.
    const { data: jobRow, error: jobErr } = await supabase
      .from("import_jobs")
      .insert({
        tenant_id: employee.tenant_id,
        resource,
        status: "DRY_RUN",
        file_name: filename,
        file_size_bytes: buffer.byteLength,
        row_count: parsed.rows.length,
        valid_row_count: validation.valid.length,
        invalid_row_count: 0,
        errors: [],
        stats: { headers: parsed.headers, format: parsed.format },
        created_by: employee.id,
      })
      .select("id")
      .single();
    if (jobErr || !jobRow) {
      return {
        ok: false,
        code: "INTERNAL",
        reason: jobErr?.message ?? "Failed to open import job.",
      };
    }
    const jobId = (jobRow as { id: string }).id;

    try {
      const { inserted, updated } = await adapter.commit({
        valid: validation.valid,
        tenantId: employee.tenant_id,
        createdBy: employee.id,
        supabase,
      });

      await supabase
        .from("import_jobs")
        .update({
          status: "COMMITTED",
          inserted_count: inserted,
          updated_count: updated,
          committed_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("tenant_id", employee.tenant_id);

      await recordAudit({
        actionType: "BULK_IMPORT",
        resourceName: "import_jobs",
        resourceId: jobId,
        newValues: {
          resource,
          file_name: filename,
          row_count: parsed.rows.length,
          inserted,
          updated,
        },
      });

      // Revalidate the resource-specific pages so newly imported rows
      // appear immediately without a hard reload.
      const paths = revalidationPathsFor(resource);
      for (const p of paths) revalidatePath(p);
      revalidatePath("/settings/bulk-import");

      // Ping the uploader when the job finishes so long imports don't
      // require staring at the browser tab. Fire-and-forget; a failed
      // notification never rolls back a successful commit (the ledger
      // row + audit log are already durable at this point).
      // `requireCurrentEmployee` guarantees `user_id` is non-null.
      void notifyUser({
        recipient: {
          userId: employee.user_id,
          employeeId: employee.id,
        },
        kind: "BULK_IMPORT_COMPLETED",
        title: `Import ${resource.toLowerCase()} selesai`,
        body:
          inserted + updated === 0
            ? `File ${filename}: tidak ada baris yang berubah (kemungkinan semua duplikat).`
            : `File ${filename}: ${inserted} ditambahkan, ${updated} diperbarui.`,
        actionUrl: `/settings/bulk-import?job=${jobId}`,
        payload: {
          job_id: jobId,
          resource,
          inserted,
          updated,
        },
        tenantId: employee.tenant_id,
      });

      return {
        ok: true,
        job_id: jobId,
        resource,
        inserted,
        updated,
      };
    } catch (commitErr) {
      const msg = commitErr instanceof Error ? commitErr.message : String(commitErr);
      // Mark FAILED so history stays honest.
      await supabase
        .from("import_jobs")
        .update({
          status: "FAILED",
          errors: [{ row_number: 0, field: null, message: msg }],
        })
        .eq("id", jobId)
        .eq("tenant_id", employee.tenant_id);
      return { ok: false, code: "COMMIT_FAILED", reason: msg };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof BulkImportParseError) {
      return { ok: false, code: "PARSE_ERROR", reason: msg };
    }
    return { ok: false, code: "INTERNAL", reason: msg };
  }
}

function revalidationPathsFor(resource: ImportResource): string[] {
  switch (resource) {
    case "EMPLOYEE":
      return ["/hr/employees", "/hr/roster"];
    case "CLIENT":
      return ["/clients"];
    case "PROJECT":
      return ["/projects"];
    case "BUDGET_LINE":
      return ["/finance/budgets"];
  }
}

// ---------------------------------------------------------------------------
// Redirect helper — used by "View history" nav on the job detail.
// ---------------------------------------------------------------------------
export async function refreshBulkImportPageAction(): Promise<void> {
  await requireCurrentEmployee();
  revalidatePath("/settings/bulk-import");
  redirect("/settings/bulk-import");
}
