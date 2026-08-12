"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
} from "@/lib/attachments/constants";

import { submitSettlementWithReceiptsAction } from "./settlement-upload-actions";

type FormValues = {
  total_spent_idr: string;
  notes: string;
};

/**
 * Panel shown to the requester on a DISBURSED cash advance to submit
 * their nota/struk reconciliation.
 *
 * The dialog also stages receipt files (nota / struk) client-side and
 * sends them together with the settlement payload as multipart FormData.
 * Server enforces: `total_spent > 0` MUST include ≥ 1 receipt (unless
 * a prior RETURNED submission's receipts are carried forward).
 *
 * `priorReturnedAttachmentCount` tells the requester how many receipts
 * from the previous returned submission will be auto-attached to the
 * new one, so they don't need to re-upload existing evidence.
 */
export function SubmitSettlementDialog({
  cashAdvanceId,
  priorReturnedAttachmentCount = 0,
}: {
  cashAdvanceId: string;
  /**
   * Non-zero when this CA already has a RETURNED settlement whose
   * receipts will be copied forward to the new submission.
   */
  priorReturnedAttachmentCount?: number;
  /** @deprecated legacy vs canonical no longer distinguished at UI level. */
  flow?: "legacy" | "canonical";
}) {
  const t = useTranslations("cashAdvances.settlement");
  const tAttach = useTranslations("cashAdvances.settlement.attachments");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    defaultValues: { total_spent_idr: "", notes: "" },
  });

  function onSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    const next: File[] = [...stagedFiles];
    for (const f of Array.from(picked)) {
      if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(f.type)) {
        toast.error(tAttach("unsupportedType", { name: f.name }));
        continue;
      }
      if (f.size > DEFAULT_MAX_BYTES) {
        toast.error(tAttach("tooLarge", { name: f.name }));
        continue;
      }
      next.push(f);
    }
    setStagedFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeStagedFile(idx: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function onSubmit(values: FormValues) {
    const cleaned = values.total_spent_idr
      .replaceAll(".", "")
      .replaceAll(",", "");
    const totalSpent = Number(cleaned);
    if (!Number.isFinite(totalSpent) || totalSpent < 0) {
      form.setError("total_spent_idr", {
        message: t("totalSpentInvalid"),
      });
      return;
    }

    // Hard-require: total_spent > 0 needs at least one attachment total
    // (new files OR carry-over from a prior RETURNED submission).
    const totalAttachmentsAvailable =
      stagedFiles.length + priorReturnedAttachmentCount;
    if (totalSpent > 0 && totalAttachmentsAvailable === 0) {
      toast.error(tAttach("requiredForSpend"));
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("cash_advance_id", cashAdvanceId);
      fd.set("total_spent_idr", String(totalSpent));
      if (values.notes.trim()) fd.set("notes", values.notes.trim());
      for (const f of stagedFiles) fd.append("files", f);

      const result = await submitSettlementWithReceiptsAction(fd);
      if (result.ok) {
        let successMsg = t("submitted");
        if (result.data.attachments_copied_forward > 0) {
          successMsg = tAttach("submittedWithCopyForward", {
            n: result.data.attachments_copied_forward,
          });
        }
        toast.success(successMsg);
        form.reset({ total_spent_idr: "", notes: "" });
        setStagedFiles([]);
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="default">
            <Send className="size-4" /> {t("submit")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("submitTitle")}</DialogTitle>
          <DialogDescription>{t("submitDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="total_spent_idr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("totalSpent")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="numeric"
                      placeholder="4500000"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("notes")}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ---- Attachments — receipts / nota / struk ---- */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  {tAttach("label")}
                  <span className="ml-1 text-rose-500" aria-hidden>
                    *
                  </span>
                </label>
                <span className="text-[11px] text-muted-foreground">
                  {tAttach("hint")}
                </span>
              </div>

              {priorReturnedAttachmentCount > 0 ? (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200"
                >
                  <Paperclip className="size-3.5" aria-hidden />
                  <span>
                    {tAttach("carryOverInfo", {
                      n: priorReturnedAttachmentCount,
                    })}
                  </span>
                </div>
              ) : null}

              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_MIME_TYPES.join(",")}
                multiple
                className="sr-only"
                onChange={onSelectFiles}
                disabled={isPending}
                aria-label={tAttach("pickerLabel")}
              />
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-input bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPending}
                    className="w-fit"
                  >
                    <Upload className="size-4" />
                    {tAttach("add")}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    {stagedFiles.length > 0
                      ? tAttach("attached", { n: stagedFiles.length })
                      : tAttach("none")}
                  </span>
                </div>

                {stagedFiles.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {stagedFiles.map((file, i) => {
                      const isImg = file.type.startsWith("image/");
                      return (
                        <li
                          key={`${file.name}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-input bg-background/60 px-2 py-1.5 text-xs"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {isImg ? (
                              <ImageIcon
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                            ) : (
                              <FileText
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                            )}
                            <span className="truncate">{file.name}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {(file.size / 1024).toFixed(0)} KB
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeStagedFile(i)}
                            disabled={isPending}
                            aria-label={tAttach("removeAria", {
                              name: file.name,
                            })}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </section>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {t("confirmSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detach button — shown next to each attachment row on the detail page.
// ---------------------------------------------------------------------------

export function DetachSettlementReceiptButton({
  settlementId,
  attachmentId,
  filename,
  onDetached,
}: {
  settlementId: string;
  attachmentId: string;
  filename: string;
  onDetached?: () => void;
}) {
  const tAttach = useTranslations("cashAdvances.settlement.attachments");
  const [isPending, startTransition] = React.useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const { detachSettlementReceiptAction } = await import(
            "./settlement-upload-actions"
          );
          const res = await detachSettlementReceiptAction({
            settlement_id: settlementId,
            attachment_id: attachmentId,
          });
          if (res.ok) {
            toast.success(tAttach("detached", { name: filename }));
            onDetached?.();
          } else {
            toast.error(res.reason);
          }
        });
      }}
      aria-label={tAttach("detachAria", { name: filename })}
    >
      {isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Trash2 className="size-3.5" />
      )}
    </Button>
  );
}
