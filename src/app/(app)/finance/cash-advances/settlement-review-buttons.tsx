"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Check, Loader2, RotateCcw } from "lucide-react";
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
  acceptSettlementSchema,
  returnSettlementSchema,
  type AcceptSettlementInput,
  type ReturnSettlementInput,
} from "@/lib/validation/cash-advance";
import {
  acceptCanonicalSettlementSchema,
  returnCanonicalSettlementSchema,
  type AcceptCanonicalSettlementInput,
  type ReturnCanonicalSettlementInput,
} from "@/lib/validation/cash-advance-canonical";

import {
  acceptSettlementAction,
  returnSettlementAction,
} from "./actions";
import {
  acceptCanonicalSettlementAction,
  returnCanonicalSettlementAction,
} from "./actions-canonical";

/**
 * Shown on the CA detail page next to a settlement whose status is SUBMITTED.
 * Only Lead Finance / TENANT_ADMIN sees this; the parent guards visibility.
 * `flow` picks the legacy or canonical review action. Input shape is
 * identical in both.
 */
export function SettlementReviewButtons({
  settlementId,
  flow = "legacy",
}: {
  settlementId: string;
  flow?: "legacy" | "canonical";
}) {
  const t = useTranslations("cashAdvances.settlement.review");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = React.useTransition();
  const [acceptOpen, setAcceptOpen] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);

  const isCanonical = flow === "canonical";

  type AcceptInput = AcceptSettlementInput | AcceptCanonicalSettlementInput;
  type ReturnInput = ReturnSettlementInput | ReturnCanonicalSettlementInput;

  const acceptForm = useForm<AcceptInput>({
    resolver: zodResolver(
      isCanonical ? acceptCanonicalSettlementSchema : acceptSettlementSchema,
    ),
    defaultValues: { settlement_id: settlementId } as AcceptInput,
  });
  const returnForm = useForm<ReturnInput>({
    resolver: zodResolver(
      isCanonical ? returnCanonicalSettlementSchema : returnSettlementSchema,
    ),
    defaultValues: { settlement_id: settlementId, reason: "" } as ReturnInput,
  });

  function onAccept(values: AcceptInput) {
    startTransition(async () => {
      const res = isCanonical
        ? await acceptCanonicalSettlementAction(
            values as AcceptCanonicalSettlementInput,
          )
        : await acceptSettlementAction(values as AcceptSettlementInput);
      if (res.ok) {
        toast.success(t("acceptedToast"));
        setAcceptOpen(false);
      } else toast.error(res.reason ?? "Failed");
    });
  }

  function onReturn(values: ReturnInput) {
    startTransition(async () => {
      const res = isCanonical
        ? await returnCanonicalSettlementAction(
            values as ReturnCanonicalSettlementInput,
          )
        : await returnSettlementAction(values as ReturnSettlementInput);
      if (res.ok) {
        toast.success(t("returnedToast"));
        setReturnOpen(false);
      } else toast.error(res.reason ?? "Failed");
    });
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="default" className="gap-1.5">
              <Check className="size-3.5" />
              {t("accept")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("acceptTitle")}</DialogTitle>
            <DialogDescription>{t("acceptDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...acceptForm}>
            <form
              onSubmit={acceptForm.handleSubmit(onAccept)}
              className="flex flex-col gap-3"
            >
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAcceptOpen(false)}
                  disabled={isPending}
                >
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t("confirmAccept")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="ghost" className="gap-1.5 text-rose-300">
              <RotateCcw className="size-3.5" />
              {t("return")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("returnTitle")}</DialogTitle>
            <DialogDescription>{t("returnDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...returnForm}>
            <form
              onSubmit={returnForm.handleSubmit(onReturn)}
              className="flex flex-col gap-3"
            >
              <FormField
                control={returnForm.control}
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
                  onClick={() => setReturnOpen(false)}
                  disabled={isPending}
                >
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t("confirmReturn")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
