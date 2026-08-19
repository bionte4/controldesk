"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  PiggyBank,
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
} from "@/lib/attachments/constants";
import {
  requestReplenishmentSchema,
  type RequestReplenishmentInput,
} from "@/lib/validation/petty-cash";

import { requestReplenishmentAction } from "./actions";
import { uploadReplenishmentAttachmentsAction } from "./replenishment-upload-actions";

type FormValues = {
  requested_amount_idr: string;
  reason: string;
};

export function RequestReplenishmentSheet({ fundId }: { fundId: string }) {
  const t = useTranslations("pettyCash.replenishment");
  const tAttach = useTranslations("pettyCash.replenishment.attachments");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([]);
  const [phase, setPhase] = React.useState<"idle" | "saving" | "uploading">(
    "idle",
  );
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    defaultValues: { requested_amount_idr: "", reason: "" },
    resolver: async (values) => {
      const parsed = requestReplenishmentSchema.safeParse({
        fund_id: fundId,
        requested_amount_idr: Number(
          values.requested_amount_idr.replaceAll(/\D/g, ""),
        ),
        reason: values.reason || undefined,
      });
      if (parsed.success) return { values, errors: {} };
      const errors: Record<string, { type: string; message: string }> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (!errors[path]) {
          errors[path] = { type: "validation", message: issue.message };
        }
      }
      return { values: {}, errors };
    },
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
    const payload: RequestReplenishmentInput = {
      fund_id: fundId,
      requested_amount_idr: Number(
        values.requested_amount_idr.replaceAll(/\D/g, ""),
      ),
      reason: values.reason || undefined,
    };
    startTransition(async () => {
      setPhase("saving");
      const result = await requestReplenishmentAction(payload);
      if (!result.ok) {
        setPhase("idle");
        toast.error(result.reason ?? "Failed to submit replenishment request.");
        return;
      }
      const replId = result.data.id;

      // Upload staged memos (best-effort — request is already persisted;
      // failed uploads surface a toast but don't roll the request back).
      if (stagedFiles.length > 0) {
        setPhase("uploading");
        const fd = new FormData();
        fd.set("replenishment_id", replId);
        for (const f of stagedFiles) fd.append("files", f);
        const upRes = await uploadReplenishmentAttachmentsAction(fd);
        if (!upRes.ok) {
          toast.error(
            tAttach("partialUploadFailed", { reason: upRes.reason }),
          );
        }
      }

      toast.success(t("submitted"));
      form.reset({ requested_amount_idr: "", reason: "" });
      setStagedFiles([]);
      setPhase("idle");
      setOpen(false);
      router.refresh();
    });
  }

  const busy = isPending || phase !== "idle";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant="secondary">
            <PiggyBank className="size-4" /> {t("open")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-5"
          >
            <FormField
              control={form.control}
              name="requested_amount_idr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("amount")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="numeric"
                      placeholder="5000000"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
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

            {/* ---- Optional memo attachments ---- */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  {tAttach("labelMemo")}
                </label>
                <span className="text-[11px] text-muted-foreground">
                  {tAttach("hint")}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_MIME_TYPES.join(",")}
                multiple
                className="sr-only"
                onChange={onSelectFiles}
                disabled={busy}
                aria-label={tAttach("pickerLabel")}
              />
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-input bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
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

            <SheetFooter className="sticky bottom-0 mt-auto -mx-5 flex-row flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-popover px-5 py-3">
              <SheetClose
                render={
                  <Button type="button" variant="ghost" disabled={busy}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {phase === "uploading" ? tAttach("uploading") : t("confirm")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
