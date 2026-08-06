"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Check, Loader2, Send, Trash2, X } from "lucide-react";
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
  approveBudgetSchema,
  cancelBudgetSchema,
  rejectBudgetSchema,
  submitBudgetSchema,
  type ApproveBudgetInput,
  type CancelBudgetInput,
  type RejectBudgetInput,
  type SubmitBudgetInput,
} from "@/lib/validation/budget";

import {
  approveBudgetAction,
  cancelBudgetAction,
  rejectBudgetAction,
  submitBudgetAction,
} from "./actions";

export type BudgetActionMode =
  | "submit"
  | "approve+reject"
  | "cancel"
  | "none";

/**
 * State-driven action bar. The parent decides which mode applies for the
 * current viewer × budget-status pair; this component just renders the right
 * dialogs and wires up the corresponding server action.
 */
export function BudgetActionButtons({
  id,
  mode,
}: {
  id: string;
  mode: BudgetActionMode;
}) {
  const t = useTranslations("budgets.actions");
  const [isPending, startTransition] = React.useTransition();

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const submitForm = useForm<SubmitBudgetInput>({
    resolver: zodResolver(submitBudgetSchema),
    defaultValues: { id },
  });
  const approveForm = useForm<ApproveBudgetInput>({
    resolver: zodResolver(approveBudgetSchema),
    defaultValues: { id, comment: "" },
  });
  const rejectForm = useForm<RejectBudgetInput>({
    resolver: zodResolver(rejectBudgetSchema),
    defaultValues: { id, reason: "" },
  });
  const cancelForm = useForm<CancelBudgetInput>({
    resolver: zodResolver(cancelBudgetSchema),
    defaultValues: { id, reason: "" },
  });

  function onSubmit(values: SubmitBudgetInput) {
    startTransition(async () => {
      const result = await submitBudgetAction(values);
      if (result.ok) toast.success(t("submittedToast"));
      else toast.error(result.reason);
    });
  }

  function onApprove(values: ApproveBudgetInput) {
    startTransition(async () => {
      const result = await approveBudgetAction(values);
      if (result.ok) {
        toast.success(t("approvedToast"));
        setApproveOpen(false);
        approveForm.reset({ id, comment: "" });
      } else {
        toast.error(result.reason);
      }
    });
  }

  function onReject(values: RejectBudgetInput) {
    startTransition(async () => {
      const result = await rejectBudgetAction(values);
      if (result.ok) {
        toast.success(t("rejectedToast"));
        setRejectOpen(false);
        rejectForm.reset({ id, reason: "" });
      } else {
        toast.error(result.reason);
      }
    });
  }

  function onCancel(values: CancelBudgetInput) {
    startTransition(async () => {
      const result = await cancelBudgetAction(values);
      if (result.ok) {
        toast.success(t("cancelledToast"));
        setCancelOpen(false);
        cancelForm.reset({ id, reason: "" });
      } else {
        toast.error(result.reason);
      }
    });
  }

  if (mode === "none") return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === "submit" ? (
        <Form {...submitForm}>
          <form onSubmit={submitForm.handleSubmit(onSubmit)}>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {t("submit")}
            </Button>
          </form>
        </Form>
      ) : null}

      {mode === "approve+reject" ? (
        <>
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
        </>
      ) : null}

      {mode === "cancel" ? (
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogTrigger
            render={
              <Button size="sm" variant="ghost">
                <Trash2 className="size-4" />
                {t("cancelBudget")}
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("cancelTitle")}</DialogTitle>
              <DialogDescription>{t("cancelDescription")}</DialogDescription>
            </DialogHeader>
            <Form {...cancelForm}>
              <form
                onSubmit={cancelForm.handleSubmit(onCancel)}
                className="flex flex-col gap-3"
              >
                <FormField
                  control={cancelForm.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("cancelReason")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder={t("cancelReasonPlaceholder")}
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
                    onClick={() => setCancelOpen(false)}
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
                    {t("confirmCancel")}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
