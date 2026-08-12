"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { DataArchiveStatus } from "@/types/database";

import {
  signArchiveUrlAction,
  verifyArchiveAction,
} from "./actions";

/**
 * Per-row admin actions on the cold-archive registry.
 *
 * • Download — calls `signArchiveUrlAction()` to mint a 300s signed URL,
 *   then triggers a browser download. The URL never lingers on-screen.
 * • Verify — calls `verifyArchiveAction()` which re-downloads the blob
 *   server-side, recomputes SHA-256, and marks `restore_verified_at`.
 *   Only rendered for TENANT_ADMIN (rules §22).
 */
export function ArchiveRowActions({
  registryId,
  status,
  canVerify,
}: {
  registryId: string;
  status: DataArchiveStatus;
  canVerify: boolean;
}) {
  const t = useTranslations("settings.archives.actions");
  const [isDownloading, startDownload] = React.useTransition();
  const [isVerifying, startVerify] = React.useTransition();

  const canDownload = status !== "PURGED" && status !== "PENDING" && status !== "FAILED";

  function onDownload() {
    startDownload(async () => {
      const res = await signArchiveUrlAction({ id: registryId });
      if (!res.ok) {
        toast.error(res.reason ?? t("downloadFailed"));
        return;
      }
      const { url } = res.data;
      // Open in a new tab so the browser handles the redirect + download
      // without the app losing state. Signed URL is scoped to the blob
      // and expires in 300s.
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success(t("downloadStarted"));
    });
  }

  function onVerify() {
    startVerify(async () => {
      const res = await verifyArchiveAction({ id: registryId });
      if (!res.ok) {
        toast.error(res.reason ?? t("verifyFailed"));
        return;
      }
      toast.success(
        t("verifySuccess", {
          checksum: res.data.recomputed_checksum.slice(0, 12),
        }),
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5"
        onClick={onDownload}
        disabled={!canDownload || isDownloading}
        aria-label={t("download")}
      >
        {isDownloading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Download className="size-3.5" />
        )}
        {t("download")}
      </Button>

      {canVerify ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onVerify}
          disabled={!canDownload || isVerifying}
          aria-label={t("verify")}
        >
          {isVerifying ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          {t("verify")}
        </Button>
      ) : null}
    </div>
  );
}
