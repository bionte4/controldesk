"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  Send,
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
import {
  approveReplenishmentSchema,
  disburseReplenishmentSchema,
  rejectReplenishmentSchema,
  type ApproveReplenishmentInput,
  type DisburseReplenishmentInput,
  type RejectReplenishmentInput,
} from "@/lib/validation/petty-cash";

import {
  approveReplenishmentAction,
  disburseReplenishmentAction,
  rejectReplenishmentAction,
} from "./actions";
import { uploadReplenishmentAttachmentsAction } from "./replenishment-upload-actions";

export function ReplenishmentActions({
  id,
  status,
}: {
  id: string;
  status: "PENDING_FINANCE" | "APPROVED";
}) {
  const t = useTranslations("pettyCash.replenishment.actions");
  const tAttach = useTranslations("pettyCash.replenishment.attachments");
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [disburseOpen, setDisburseOpen] = React.useState(false);

  // Transfer-proof staging (disburse only).
  const [stagedProof, setStagedProof] = React.useState<File[]>([]);
  const [uploadPhase, setUploadPhase] = React.useState<
    "idle" | "saving" | "uploading"
  >("idle");
  const proofInputRef = React.useRef<HTMLInputElement>(null);

  const approveForm = useForm<ApproveReplenishmentInput>({
    resolver: zodResolver(approveReplenishmentSchema),
    defaultValues: { id, comment: "" },
  });
  const rejectForm = useForm<RejectReplenishmentInput>({
    resolver: zodResolver(rejectReplenishmentSchema),
    defaultValues: { id, reason: "" },
  });
  const disburseForm = useForm<DisburseReplenishmentInput>({
    resolver: zodResolver(disburseReplenishmentSchema),
    defaultValues: { id, disbursement_ref: "" },
  });

  function onProofPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    const next: File[] = [...stagedProof];
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
    setStagedProof(next);
    if (proofInputRef.current) proofInputRef.current.value = "";
  }

  function removeProof(idx: number) {
    setStagedProof((prev) => prev.filter((_, i) => i !== idx));
  }

  function onApprove(values: ApproveReplenishmentInput) {
    startTransition(async () => {
      const result = await approveReplenishmentAction(values);
      if (result.ok) {
        toast.success(t("approvedToast"));
        setApproveOpen(false);
        router.refresh();
      } else toast.error(result.reason);
    });
  }

  function onReject(values: RejectReplenishmentInput) {
    startTransition(async () => {
      const result = await rejectReplenishmentAction(values);
      if (result.ok) {
        toast.success(t("rejectedToast"));
        setRejectOpen(false);
        router.refresh();
      } else toast.error(result.reason);
    });
  }

  function onDisburse(values: DisburseReplenishmentInput) {
    startTransition(async () => {
      setUploadPhase("saving");
      const result = await disburseReplenishmentAction(values);
      if (!result.ok) {
        setUploadPhase("idle");
        toast.error(result.reason);
        return;
      }

      // Attach transfer proof (soft-recommended, so best-effort — a
      // failed upload here surfaces a toast but does not roll back
      // the disbursement which has already updated the fund balance).
      if (stagedProof.length > 0) {
        setUploadPhase("uploading");
        const fd = new FormData();
        fd.set("replenishment_id", id);
        for (const f of stagedProof) fd.append("files", f);
        const upRes = await uploadReplenishmentAttachmentsAction(fd);
        if (!upRes.ok) {
          toast.error(
            tAttach("partialUploadFailed", { reason: upRes.reason }),
          );
        }
      }

      toast.success(t("disbursedToast"));
      setStagedProof([]);
      setUploadPhase("idle");
      setDisburseOpen(false);
      router.refresh();
    });
  }

  const busy = isPending || uploadPhase !== "idle";

  if (status === "APPROVED") {
    return (
      <Dialog open={disburseOpen} onOpenChange={setDisburseOpen}>
        <DialogTrigger
          render={
            <Button size="sm">
              <Send className="size-4" /> {t("disburse")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("disburseTitle")}</DialogTitle>
            <DialogDescription>{t("disburseDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...disburseForm}>
            <form
              onSubmit={disburseForm.handleSubmit(onDisburse)}
              className="flex flex-col gap-4"
            >
              <FormField
                control={disburseForm.control}
                name="disbursement_ref"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("disbursementRef")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="BCA/2026-08/00456" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* ---- Transfer proof staging (recommended) ---- */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    {tAttach("labelTransferProof")}
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    {tAttach("hint")}
                  </span>
                </div>
                <input
                  ref={proofInputRef}
                  type="file"
                  accept={ALLOWED_MIME_TYPES.join(",")}
                  multiple
                  className="sr-only"
                  onChange={onProofPicked}
                  disabled={busy}
                  aria-label={tAttach("pickerLabelProof")}
                />
                <div className="flex flex-col gap-2 rounded-lg border border-dashed border-input bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => proofInputRef.current?.click()}
                      disabled={busy}
                      className="w-fit"
                    >
                      <Upload className="size-4" />
                      {tAttach("addProof")}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      {stagedProof.length > 0
                        ? tAttach("attached", { n: stagedProof.length })
                        : tAttach("none")}
                    </span>
                  </div>
                  {stagedProof.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {stagedProof.map((file, i) => {
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
                              onClick={() => removeProof(i)}
                              disabled={busy}
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
                  onClick={() => setDisburseOpen(false)}
                  disabled={busy}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {uploadPhase === "uploading"
                    ? tAttach("uploading")
                    : t("confirmDisburse")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogTrigger
          render={
            <Button size="sm">
              <Check className="size-4" /> {t("approve")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("approveTitle")}</DialogTitle>
            <DialogDescription>{t("approveDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...approveForm}>
            <form
              onSubmit={approveForm.handleSubmit(onApprove)}
              className="flex flex-col gap-3"
            >
              <FormField
                control={approveForm.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("comment")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder={t("commentPlaceholder")}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setApproveOpen(false)}
                  disabled={isPending}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t("confirmApprove")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="destructive">
              <X className="size-4" /> {t("reject")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("rejectDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...rejectForm}>
            <form
              onSubmit={rejectForm.handleSubmit(onReject)}
              className="flex flex-col gap-3"
            >
              <FormField
                control={rejectForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("reason")}</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRejectOpen(false)}
                  disabled={isPending}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" variant="destructive" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t("confirmReject")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
