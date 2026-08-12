"use server";

/**
 * ControlDesk — Project Issue attachments (rules §19 + §26).
 *
 * Attachments per issue capture the evidence that turns a text ticket into
 * something actionable: screenshot, stack trace, log excerpt, business
 * document. Stored via the generic `attachments` registry with
 * `resource_type = "project_issue"`. Storage path:
 * `{tenant_id}/project_issue/{issue_id}/{uuid}.ext` (rules §19).
 *
 * Who can attach:
 *   * The reporter (they raised it — they have context).
 *   * The current assignee (they're working on it — they collect evidence).
 *   * SUPERVISOR / PROJECT_MANAGER / OPERATIONS_MANAGER / HEAD_MANAGER /
 *     GENERAL_MANAGER / TENANT_ADMIN — triage roles who may need to enrich
 *     an issue.
 *
 * Editable window: while the issue is OPEN / IN_PROGRESS / REOPENED. Once
 * RESOLVED or CLOSED the timeline is locked to keep the audit trail honest;
 * an issue that needs new evidence should be reopened first.
 */

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { recordAudit } from "@/lib/security/audit";
import { createClient } from "@/lib/supabase/server";
import {
  BUCKET_ID,
  isAllowedMime,
  uploadAttachment,
} from "@/lib/attachments";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type { ActionResult } from "@/lib/security/action-wrapper";
import type { ProjectIssueStatus } from "@/types/database";

// Statuses that permit attaching new evidence.
const ATTACHABLE_STATUSES: readonly ProjectIssueStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "REOPENED",
];

// Roles that may attach even if they are not reporter/assignee (triage crew).
const TRIAGE_ROLES: readonly AnyDbEmployeeRole[] = [
  "SUPERVISOR",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
  "PM",
  "OM",
  "DIRECTOR",
  "ADMIN",
];

type IssueRow = {
  id: string;
  project_id: string;
  reporter_employee_id: string;
  assignee_employee_id: string | null;
  status: ProjectIssueStatus;
};

async function loadIssueRow(
  issueId: string,
  tenantId: string,
): Promise<IssueRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_issues")
    .select(
      "id, project_id, reporter_employee_id, assignee_employee_id, status",
    )
    .eq("id", issueId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as unknown as IssueRow) ?? null;
}

/**
 * UPLOAD — multipart FormData with `issue_id` + one or more `files`.
 */
export async function uploadIssueAttachmentsAction(
  formData: FormData,
): Promise<ActionResult<{ uploaded: number; attachment_ids: string[] }>> {
  const issueId = formData.get("issue_id");
  if (typeof issueId !== "string" || issueId.length < 8) {
    return { ok: false, code: "VALIDATION", reason: "issue_id missing" };
  }
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { ok: false, code: "VALIDATION", reason: "No files provided." };
  }
  for (const f of files) {
    if (!isAllowedMime(f.type)) {
      return {
        ok: false,
        code: "VALIDATION",
        reason: `Unsupported file type: ${f.type} (${f.name})`,
      };
    }
  }

  const employee = await requireCurrentEmployee();
  const legacyRole = employee.role as AnyDbEmployeeRole;

  const row = await loadIssueRow(issueId, employee.tenant_id);
  if (!row) {
    return { ok: false, code: "FORBIDDEN", reason: "Issue not found." };
  }

  if (!ATTACHABLE_STATUSES.includes(row.status)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Attachments are locked while issue is ${row.status}. Reopen it first if new evidence is needed.`,
    };
  }

  const isReporter = row.reporter_employee_id === employee.id;
  const isAssignee = row.assignee_employee_id === employee.id;
  const isTriage = TRIAGE_ROLES.includes(legacyRole);
  if (!isReporter && !isAssignee && !isTriage) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason:
        "Only the reporter, assignee, or a supervisor+ can attach files to an issue.",
    };
  }

  const uploadedIds: string[] = [];
  for (const file of files) {
    try {
      const res = await uploadAttachment({
        tenantId: employee.tenant_id,
        uploaderEmployeeId: employee.id,
        resourceType: "project_issue",
        resourceId: row.id,
        file,
      });
      uploadedIds.push(res.attachment.id);
    } catch (err) {
      return {
        ok: false,
        code: "INTERNAL",
        reason: err instanceof Error ? err.message : "upload failed",
      };
    }
  }

  await recordAudit({
    actionType: "CREATE",
    resourceName: "attachments",
    resourceId: row.id,
    newValues: {
      issue_id: row.id,
      project_id: row.project_id,
      files_uploaded: uploadedIds.length,
      attachment_ids: uploadedIds,
      uploader_kind: isReporter
        ? "REPORTER"
        : isAssignee
          ? "ASSIGNEE"
          : "TRIAGE",
    },
  }).catch(() => {});

  revalidatePath(`/projects/${row.project_id}`);
  revalidatePath(`/projects/${row.project_id}/issues`);
  revalidatePath("/approvals");

  return {
    ok: true,
    data: { uploaded: uploadedIds.length, attachment_ids: uploadedIds },
  };
}

/**
 * DETACH — remove an attachment. Uploader can delete their own file while
 * the issue is still open; PM+/Tenant Admin may delete any.
 */
export async function detachIssueAttachmentAction(input: {
  issue_id: string;
  attachment_id: string;
}): Promise<ActionResult<{ id: string }>> {
  if (
    !input?.issue_id ||
    typeof input.issue_id !== "string" ||
    !input?.attachment_id ||
    typeof input.attachment_id !== "string"
  ) {
    return { ok: false, code: "VALIDATION", reason: "invalid input" };
  }

  const employee = await requireCurrentEmployee();
  const legacyRole = employee.role as AnyDbEmployeeRole;

  const row = await loadIssueRow(input.issue_id, employee.tenant_id);
  if (!row) {
    return { ok: false, code: "FORBIDDEN", reason: "Issue not found." };
  }
  if (!ATTACHABLE_STATUSES.includes(row.status)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Attachments are locked while issue is ${row.status}.`,
    };
  }

  const supabase = await createClient();
  const { data: att } = await supabase
    .from("attachments")
    .select(
      "id, storage_path, resource_type, resource_id, uploaded_by, tenant_id",
    )
    .eq("id", input.attachment_id)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!att) {
    return { ok: false, code: "FORBIDDEN", reason: "Attachment not found." };
  }
  if (
    att.resource_type !== "project_issue" ||
    att.resource_id !== input.issue_id
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Attachment does not belong to this issue.",
    };
  }

  // Uploader can always detach their own file. PM+ / admin can detach any.
  const isOwner = att.uploaded_by === employee.id;
  const isAdminOrPmPlus: readonly AnyDbEmployeeRole[] = [
    "TENANT_ADMIN",
    "ADMIN",
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "HEAD_MANAGER",
    "GENERAL_MANAGER",
    "PM",
    "OM",
    "DIRECTOR",
  ];
  if (!isOwner && !isAdminOrPmPlus.includes(legacyRole)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "You can only detach files you uploaded (or need PM+ role).",
    };
  }

  const { error: delErr } = await supabase
    .from("attachments")
    .delete()
    .eq("id", att.id);
  if (delErr) {
    return { ok: false, code: "INTERNAL", reason: delErr.message };
  }
  await supabase.storage
    .from(BUCKET_ID)
    .remove([att.storage_path])
    .catch(() => {
      /* orphan bounded — signed URL TTL is short */
    });

  await recordAudit({
    actionType: "DELETE",
    resourceName: "attachments",
    resourceId: att.id,
    oldValues: {
      issue_id: input.issue_id,
      storage_path: att.storage_path,
    },
  }).catch(() => {});

  revalidatePath(`/projects/${row.project_id}`);
  revalidatePath(`/projects/${row.project_id}/issues`);

  return { ok: true, data: { id: att.id } };
}
