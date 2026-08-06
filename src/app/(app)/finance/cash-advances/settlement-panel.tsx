"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Send } from "lucide-react";
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
  submitSettlementSchema,
  type SubmitSettlementInput,
} from "@/lib/validation/cash-advance";
import {
  submitCanonicalSettlementSchema,
  type SubmitCanonicalSettlementInput,
} from "@/lib/validation/cash-advance-canonical";

import { submitSettlementAction } from "./actions";
import { submitCanonicalSettlementAction } from "./actions-canonical";

type FormValues = {
  total_spent_idr: string;
  notes: string;
};

/**
 * Panel shown to the requester on a DISBURSED cash advance to submit
 * their nota/struk reconciliation. `flow` picks the legacy vs canonical
 * settlement action (payload is identical in both).
 */
export function SubmitSettlementDialog({
  cashAdvanceId,
  flow = "legacy",
}: {
  cashAdvanceId: string;
  flow?: "legacy" | "canonical";
}) {
  const t = useTranslations("cashAdvances.settlement");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const isCanonical = flow === "canonical";

  const form = useForm<FormValues>({
    defaultValues: { total_spent_idr: "", notes: "" },
    resolver: async (values) => {
      const rawAmount = Number(
        values.total_spent_idr.replaceAll(".", "").replaceAll(",", ""),
      );
      const schema = isCanonical
        ? submitCanonicalSettlementSchema
        : submitSettlementSchema;
      const parsed = schema.safeParse({
        cash_advance_id: cashAdvanceId,
        total_spent_idr: rawAmount,
        notes: values.notes || undefined,
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

  function onSubmit(values: FormValues) {
    const cleaned = values.total_spent_idr
      .replaceAll(".", "")
      .replaceAll(",", "");
    const payload: SubmitSettlementInput | SubmitCanonicalSettlementInput = {
      cash_advance_id: cashAdvanceId,
      total_spent_idr: Number(cleaned),
      notes: values.notes || undefined,
    };
    startTransition(async () => {
      const result = isCanonical
        ? await submitCanonicalSettlementAction(
            payload as SubmitCanonicalSettlementInput,
          )
        : await submitSettlementAction(payload as SubmitSettlementInput);
      if (result.ok) {
        toast.success(t("submitted"));
        form.reset({ total_spent_idr: "", notes: "" });
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("submitTitle")}</DialogTitle>
          <DialogDescription>{t("submitDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-3"
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
