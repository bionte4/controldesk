"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Check, Loader2, Play, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  approvePmHandoverSchema,
  rejectPmHandoverSchema,
  type ApprovePmHandoverInput,
  type RejectPmHandoverInput,
} from "@/lib/validation/handover";

import {
  approvePmHandoverAction,
  executePmHandoverAction,
  rejectPmHandoverAction,
} from "./actions";

export function HandoverActionButtons({
  id,
  mode,
}: {
  id: string;
  mode: "approve" | "execute";
}) {
  const t = useTranslations("handovers.actions");
  const [isPending, startTransition] = React.useTransition();

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [executeOpen, setExecuteOpen] = React.useState(false);

  const approveForm = useForm<ApprovePmHandoverInput>({
    resolver: zodResolver(approvePmHandoverSchema),
    defaultValues: { id, comment: "" },
  });
  const rejectForm = useForm<RejectPmHandoverInput>({
    resolver: zodResolver(rejectPmHandoverSchema),
    defaultValues: { id, reason: "" },
  });

  function onApprove(values: ApprovePmHandoverInput) {
    startTransition(async () => {
      const res = await approvePmHandoverAction(values);
      if (res.ok) {
        toast.success(t("approvedToast"));
        setApproveOpen(false);
        approveForm.reset({ id, comment: "" });
      } else {
        toast.error(res.reason);
      }
    });
  }

  function onReject(values: RejectPmHandoverInput) {
    startTransition(async () => {
      const res = await rejectPmHandoverAction(values);
      if (res.ok) {
        toast.success(t("rejectedToast"));
        setRejectOpen(false);
        rejectForm.reset({ id, reason: "" });
      } else {
        toast.error(res.reason);
      }
    });
  }

  function onExecute() {
    startTransition(async () => {
      const res = await executePmHandoverAction({ id });
      if (res.ok) {
        toast.success(t("executedToast"));
        setExecuteOpen(false);
      } else {
        toast.error(res.reason);
      }
    });
  }

  if (mode === "execute") {
    return (
      <Dialog open={executeOpen} onOpenChange={setExecuteOpen}>
        <DialogTrigger
          render={
            <Button size="sm">
              <Play className="size-4" /> {t("execute")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("executeTitle")}</DialogTitle>
            <DialogDescription>{t("executeDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setExecuteOpen(false)}
              disabled={isPending}
            >
              {t("cancel")}
            </Button>
            <Button onClick={onExecute} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              {t("confirmExecute")}
            </Button>
          </DialogFooter>
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
                      <Textarea
                        rows={3}
                        placeholder={t("reasonPlaceholder")}
                        {...field}
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
                  onClick={() => setRejectOpen(false)}
                  disabled={isPending}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={isPending}
                >
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
