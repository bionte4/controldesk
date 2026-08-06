"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Check, Loader2, Send, X } from "lucide-react";
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

export function ReplenishmentActions({
  id,
  status,
}: {
  id: string;
  status: "PENDING_FINANCE" | "APPROVED";
}) {
  const t = useTranslations("pettyCash.replenishment.actions");
  const [isPending, startTransition] = React.useTransition();
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [disburseOpen, setDisburseOpen] = React.useState(false);

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

  function onApprove(values: ApproveReplenishmentInput) {
    startTransition(async () => {
      const result = await approveReplenishmentAction(values);
      if (result.ok) {
        toast.success(t("approvedToast"));
        setApproveOpen(false);
      } else toast.error(result.reason);
    });
  }
  function onReject(values: RejectReplenishmentInput) {
    startTransition(async () => {
      const result = await rejectReplenishmentAction(values);
      if (result.ok) {
        toast.success(t("rejectedToast"));
        setRejectOpen(false);
      } else toast.error(result.reason);
    });
  }
  function onDisburse(values: DisburseReplenishmentInput) {
    startTransition(async () => {
      const result = await disburseReplenishmentAction(values);
      if (result.ok) {
        toast.success(t("disbursedToast"));
        setDisburseOpen(false);
      } else toast.error(result.reason);
    });
  }

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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("disburseTitle")}</DialogTitle>
            <DialogDescription>{t("disburseDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...disburseForm}>
            <form
              onSubmit={disburseForm.handleSubmit(onDisburse)}
              className="flex flex-col gap-3"
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
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDisburseOpen(false)}
                  disabled={isPending}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t("confirmDisburse")}
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
