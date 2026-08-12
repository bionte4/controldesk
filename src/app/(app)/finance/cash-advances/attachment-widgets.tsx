"use client";

/**
 * ControlDesk — Attachment widgets for Cash Advances.
 *
 * Mirrors the Expenses receipt widgets (`draft-widgets.tsx`) but scoped
 * to the `cash_advance` resource_type. Used on the CA detail page for
 * Field-Ops rows where reviewers need the Gmap screenshot, memo
 * pendukung, and site photos alongside the RAB breakdown.
 */

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ALLOWED_MIME_TYPES } from "@/lib/attachments/constants";

import {
  detachCashAdvanceAttachmentAction,
  uploadCashAdvanceAttachmentsAction,
} from "./upload-actions";
import { detachSettlementReceiptAction } from "./settlement-upload-actions";

// ---------------------------------------------------------------------------
// Upload widget — pick multiple files, upload in one round trip.
// ---------------------------------------------------------------------------

export function UploadCashAdvanceAttachments({
  cashAdvanceId,
  disabled,
}: {
  cashAdvanceId: string;
  disabled?: boolean;
}) {
  const t = useTranslations("cashAdvances.attachments");
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = React.useTransition();

  function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fd = new FormData();
    fd.set("cash_advance_id", cashAdvanceId);
    for (const f of Array.from(files)) fd.append("files", f);
    startTransition(async () => {
      const res = await uploadCashAdvanceAttachmentsAction(fd);
      if (res.ok) {
        toast.success(t("uploadedToast", { n: res.data.uploaded }));
        router.refresh();
      } else {
        toast.error(res.reason);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(",")}
        multiple
        className="sr-only"
        onChange={onFilesPicked}
        disabled={disabled || isPending}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isPending}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}
        {t("upload")}
      </Button>
      <p className="text-[11px] text-muted-foreground">{t("uploadHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attached files list — thumbnails for images, filename badge for PDFs.
// ---------------------------------------------------------------------------

export type CashAdvanceAttachmentEntry = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  signed_url: string;
};

export function AttachedCashAdvanceFiles({
  cashAdvanceId,
  attachments,
  canDelete,
}: {
  cashAdvanceId: string;
  attachments: CashAdvanceAttachmentEntry[];
  canDelete: boolean;
}) {
  const t = useTranslations("cashAdvances.attachments");
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const router = useRouter();

  function onDelete(id: string) {
    setPendingId(id);
    detachCashAdvanceAttachmentAction({
      cash_advance_id: cashAdvanceId,
      attachment_id: id,
    })
      .then((res) => {
        if (res.ok) {
          toast.success(t("removedToast"));
          router.refresh();
        } else {
          toast.error(res.reason);
        }
      })
      .finally(() => setPendingId(null));
  }

  if (attachments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("empty")}</p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {attachments.map((r) => {
        const isImage = r.mime_type.startsWith("image/");
        return (
          <li
            key={r.id}
            className="group relative overflow-hidden rounded-lg border border-border/50 bg-muted/20"
          >
            <div className="relative aspect-video bg-muted/40">
              {isImage && r.signed_url ? (
                <Image
                  src={r.signed_url}
                  alt={r.filename}
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <FileText className="size-10 text-muted-foreground" />
                </div>
              )}
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(r.id)}
                  disabled={pendingId === r.id}
                  aria-label={t("remove")}
                  className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                >
                  {pendingId === r.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </button>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <a
                href={r.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-xs hover:text-primary"
              >
                {r.filename}
              </a>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {(r.size_bytes / 1024).toFixed(0)} KB
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Settlement receipts — compact inline list rendered under each settlement
// row on the CA detail page. Reuses AttachmentEntry shape for signed URLs.
// ---------------------------------------------------------------------------

export type SettlementAttachmentEntry = CashAdvanceAttachmentEntry;

export function SettlementAttachmentList({
  settlementId,
  files,
  canDetach,
}: {
  settlementId: string;
  files: SettlementAttachmentEntry[];
  canDetach: boolean;
}) {
  const t = useTranslations("cashAdvances.settlement.attachments");
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const router = useRouter();

  function onDelete(id: string) {
    setPendingId(id);
    detachSettlementReceiptAction({
      settlement_id: settlementId,
      attachment_id: id,
    })
      .then((res) => {
        if (res.ok) {
          toast.success(t("removedToast"));
          router.refresh();
        } else {
          toast.error(res.reason);
        }
      })
      .finally(() => setPendingId(null));
  }

  if (files.length === 0) {
    return (
      <p className="text-[11px] italic text-muted-foreground">{t("none")}</p>
    );
  }

  return (
    <ul
      className="mt-1 flex flex-wrap gap-2"
      aria-label={t("listAria")}
    >
      {files.map((r) => {
        const isImage = r.mime_type.startsWith("image/");
        return (
          <li
            key={r.id}
            className="group inline-flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2 py-1 text-xs"
          >
            {isImage && r.signed_url ? (
              <a
                href={r.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="relative inline-block size-8 overflow-hidden rounded"
                aria-label={r.filename}
              >
                <Image
                  src={r.signed_url}
                  alt={r.filename}
                  fill
                  sizes="32px"
                  className="object-cover"
                  unoptimized
                />
              </a>
            ) : (
              <span className="grid size-8 place-items-center rounded bg-muted">
                <FileText className="size-4 text-muted-foreground" />
              </span>
            )}
            <a
              href={r.signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[10rem] truncate hover:text-primary"
              title={r.filename}
            >
              {r.filename}
            </a>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {(r.size_bytes / 1024).toFixed(0)} KB
            </span>
            {canDetach ? (
              <button
                type="button"
                onClick={() => onDelete(r.id)}
                disabled={pendingId === r.id}
                aria-label={t("detachAria", { name: r.filename })}
                className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
              >
                {pendingId === r.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <X className="size-3" />
                )}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
