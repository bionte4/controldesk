"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Check, Loader2, X } from "lucide-react";
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
  approveExpenseSchema,
  rejectExpenseSchema,
  type ApproveExpenseInput,
  type RejectExpenseInput,
} from "@/lib/validation/expense";

import { approveExpenseAction, rejectExpenseAction } from "./actions";

/**
 * Approver-side action bar: paired Approve + Reject buttons with a comment /
 * reason dialog. Used on the expense detail page and inside the approvals
 * inbox row overlay.
 */
export function ExpenseActionButtons({ id }: { id: string }) {
  const t = useTranslations("expenses.actions");
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  const approveForm = useForm<ApproveExpenseInput>({
    resolver: zodResolver(approveExpenseSchema),
    defaultValues: { id, comment: "" },
  });

  const rejectForm = useForm<RejectExpenseInput>({
    resolver: zodResolver(rejectExpenseSchema),
    defaultValues: { id, reason: "" },
  });

  function onApprove(values: ApproveExpenseInput) {
    startTransition(async () => {
      const result = await approveExpenseAction(values);
      if (result.ok) {
        toast.success(t("approvedToast"));
        setApproveOpen(false);
        approveForm.reset({ id, comment: "" });
        // Force the current RSC tree to re-fetch so the status badge,
        // timeline entries, and terminal-state UI (hide action bar) update
        // in-place instead of leaving the operator on a stale page.
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  }

  function onReject(values: RejectExpenseInput) {
    startTransition(async () => {
      const result = await rejectExpenseAction(values);
      if (result.ok) {
        toast.success(t("rejectedToast"));
        setRejectOpen(false);
        rejectForm.reset({ id, reason: "" });
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="default">
              <Check className="size-4" />
              {t("approve")}
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
              <X className="size-4" />
              {t("reject")}
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
