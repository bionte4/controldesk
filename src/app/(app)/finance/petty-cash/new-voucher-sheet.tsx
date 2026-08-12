"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PETTY_CASH_CATEGORIES,
  createPettyCashVoucherSchema,
  type CreatePettyCashVoucherInput,
} from "@/lib/validation/petty-cash";

import { recordPettyCashVoucherAction } from "./actions";

export type CoaOption = { id: string; code: string; name: string };

const COA_NONE = "__none__";

type FormValues = {
  amount_idr: string;
  category: (typeof PETTY_CASH_CATEGORIES)[number];
  coa_id: string;
  description: string;
  incurred_on: string;
  receipt_url: string;
};

const DEFAULT_VALUES: FormValues = {
  amount_idr: "",
  category: "SUPPLIES",
  coa_id: "",
  description: "",
  incurred_on: new Date().toISOString().slice(0, 10),
  receipt_url: "",
};

export function NewVoucherSheet({
  fundId,
  coaOptions = [],
}: {
  fundId: string;
  /**
   * Active + postable Chart of Accounts entries for this tenant. Empty
   * → CoA picker hidden. Since custodians are typically Finance staff
   * we default to showing the picker whenever accounts exist.
   */
  coaOptions?: readonly CoaOption[];
}) {
  const t = useTranslations("pettyCash");
  const tf = useTranslations("pettyCash.voucherForm");
  const tCat = useTranslations("pettyCash.categories");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: async (values) => {
      const parsed = createPettyCashVoucherSchema.safeParse({
        fund_id: fundId,
        amount_idr: Number(values.amount_idr.replaceAll(/\D/g, "")),
        category: values.category,
        coa_id:
          values.coa_id && values.coa_id !== COA_NONE
            ? values.coa_id
            : undefined,
        description: values.description,
        incurred_on: values.incurred_on,
        receipt_url: values.receipt_url || undefined,
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
    const payload: CreatePettyCashVoucherInput = {
      fund_id: fundId,
      amount_idr: Number(values.amount_idr.replaceAll(/\D/g, "")),
      category: values.category,
      coa_id:
        values.coa_id && values.coa_id !== COA_NONE
          ? values.coa_id
          : undefined,
      description: values.description,
      incurred_on: values.incurred_on,
      receipt_url: values.receipt_url || undefined,
    };
    startTransition(async () => {
      const result = await recordPettyCashVoucherAction(payload);
      if (result.ok) {
        toast.success(tf("recorded"));
        form.reset(DEFAULT_VALUES);
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" />
            {t("newVoucher")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("title")}</SheetTitle>
          <SheetDescription>{tf("description")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="amount_idr"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("amount")}</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="numeric" placeholder="150000" />
                    </FormControl>
                    <p className="text-[10px] text-muted-foreground">
                      {tf("amountHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("category")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PETTY_CASH_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {tCat(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="incurred_on"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("incurredOn")}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("descriptionLabel")}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} placeholder={tf("descriptionPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {coaOptions.length > 0 ? (
              <FormField
                control={form.control}
                name="coa_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("coaAccount")}</FormLabel>
                    <Select
                      value={field.value || COA_NONE}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={tf("coaPlaceholder")}>
                            {(value) => {
                              if (!value || value === COA_NONE) {
                                return tf("coaNone");
                              }
                              const hit = coaOptions.find(
                                (o) => o.id === value,
                              );
                              return hit ? `${hit.code} · ${hit.name}` : value;
                            }}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value={COA_NONE}>{tf("coaNone")}</SelectItem>
                        {coaOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.code} · {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">
                      {tf("coaHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <FormField
              control={form.control}
              name="receipt_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("receiptUrl")}</FormLabel>
                  <FormControl>
                    <Input {...field} type="url" placeholder="https://…" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
              <SheetClose
                render={
                  <Button variant="ghost" type="button" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {tf("submit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
