"use client";

/**
 * ControlDesk — Client-side widget rendering signed attachment thumbnails
 * for a single petty cash replenishment. Mirrors the settlement receipts
 * chip list in cash advances.
 */

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { detachReplenishmentAttachmentAction } from "./replenishment-upload-actions";

export type ReplenishmentAttachmentEntry = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  signed_url: string;
  uploaded_by: string | null;
};

export function ReplenishmentAttachmentList({
  replenishmentId,
  files,
  canDetachOwn,
  currentEmployeeId,
}: {
  replenishmentId: string;
  files: ReplenishmentAttachmentEntry[];
  /**
   * When true, the "delete" button is rendered next to any file the
   * current employee originally uploaded. The server double-checks
   * ownership + state, so this is purely a UX affordance.
   */
  canDetachOwn: boolean;
  currentEmployeeId: string | null;
}) {
  const t = useTranslations("pettyCash.replenishment.attachments");
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const router = useRouter();

  function onDelete(id: string) {
    setPendingId(id);
    detachReplenishmentAttachmentAction({
      replenishment_id: replenishmentId,
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
        const isOwn =
          canDetachOwn &&
          currentEmployeeId != null &&
          r.uploaded_by === currentEmployeeId;
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
            {isOwn ? (
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
