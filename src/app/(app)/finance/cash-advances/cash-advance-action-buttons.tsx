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
  approveCashAdvanceSchema,
  disburseCashAdvanceSchema,
  rejectCashAdvanceSchema,
  type ApproveCashAdvanceInput,
  type DisburseCashAdvanceInput,
  type RejectCashAdvanceInput,
} from "@/lib/validation/cash-advance";
import {
  approveCanonicalCashAdvanceSchema,
  disburseCanonicalCashAdvanceSchema,
  rejectCanonicalCashAdvanceSchema,
  type ApproveCanonicalCashAdvanceInput,
  type DisburseCanonicalCashAdvanceInput,
  type RejectCanonicalCashAdvanceInput,
} from "@/lib/validation/cash-advance-canonical";

import {
  approveCashAdvanceAction,
  disburseCashAdvanceAction,
  rejectCashAdvanceAction,
} from "./actions";
import {
  approveCanonicalCashAdvanceAction,
  disburseCanonicalCashAdvanceAction,
  rejectCanonicalCashAdvanceAction,
} from "./actions-canonical";

/**
 * Two visual modes and two action flavours:
 *   - `mode="approve"` shows Approve/Reject dialogs (approver chain).
 *   - `mode="disburse"` shows Disburse dialog (Lead Finance releases funds).
 * The `flow` prop controls which backend action runs:
 *   - `flow="legacy"` (default) — Fase 1.4 chain with `PENDING_L*` statuses.
 *   - `flow="canonical"` — GAS-aligned chain with `PENDING_*` statuses.
 * The caller decides which flow to use based on the current row's status.
 */
export function CashAdvanceActionButtons({
  id,
  mode,
  flow = "legacy",
}: {
  id: string;
  mode: "approve" | "disburse";
  flow?: "legacy" | "canonical";
}) {
  const t = useTranslations("cashAdvances.actions");
  const [isPending, startTransition] = React.useTransition();
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [disburseOpen, setDisburseOpen] = React.useState(false);

  const isCanonical = flow === "canonical";

  // Both flows have the same shape for approve/reject/disburse (canonical
  // adds an optional `note` on disburse). We union the input types so the
  // form works for both.
  type ApproveInput =
    | ApproveCashAdvanceInput
    | ApproveCanonicalCashAdvanceInput;
  type RejectInput =
    | RejectCashAdvanceInput
    | RejectCanonicalCashAdvanceInput;
  type DisburseInput =
    | DisburseCashAdvanceInput
    | DisburseCanonicalCashAdvanceInput;

  const approveForm = useForm<ApproveInput>({
    resolver: zodResolver(
      isCanonical
        ? approveCanonicalCashAdvanceSchema
        : approveCashAdvanceSchema,
    ),
    defaultValues: { id, comment: "" } as ApproveInput,
  });
  const rejectForm = useForm<RejectInput>({
    resolver: zodResolver(
      isCanonical ? rejectCanonicalCashAdvanceSchema : rejectCashAdvanceSchema,
    ),
    defaultValues: { id, reason: "" } as RejectInput,
  });
  const disburseForm = useForm<DisburseInput>({
    resolver: zodResolver(
      isCanonical
        ? disburseCanonicalCashAdvanceSchema
        : disburseCashAdvanceSchema,
    ),
    defaultValues: { id, disbursement_ref: "" } as DisburseInput,
  });

  function onApprove(values: ApproveInput) {
    startTransition(async () => {
      const result = isCanonical
        ? await approveCanonicalCashAdvanceAction(
            values as ApproveCanonicalCashAdvanceInput,
          )
        : await approveCashAdvanceAction(values as ApproveCashAdvanceInput);
      if (result.ok) {
        toast.success(t("approvedToast"));
        setApproveOpen(false);
      } else toast.error(result.reason);
    });
  }

  function onReject(values: RejectInput) {
    startTransition(async () => {
      const result = isCanonical
        ? await rejectCanonicalCashAdvanceAction(
            values as RejectCanonicalCashAdvanceInput,
          )
        : await rejectCashAdvanceAction(values as RejectCashAdvanceInput);
      if (result.ok) {
        toast.success(t("rejectedToast"));
        setRejectOpen(false);
      } else toast.error(result.reason);
    });
  }

  function onDisburse(values: DisburseInput) {
    startTransition(async () => {
      const result = isCanonical
        ? await disburseCanonicalCashAdvanceAction(
            values as DisburseCanonicalCashAdvanceInput,
          )
        : await disburseCashAdvanceAction(values as DisburseCashAdvanceInput);
      if (result.ok) {
        toast.success(t("disbursedToast"));
        setDisburseOpen(false);
      } else toast.error(result.reason);
    });
  }

  if (mode === "disburse") {
    return (
      <Dialog open={disburseOpen} onOpenChange={setDisburseOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="default">
              <Send className="size-4" />
              {t("disburse")}
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
                      <Input {...field} placeholder="BCA/2026-08/00123" />
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
