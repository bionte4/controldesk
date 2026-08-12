"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  createPettyCashFundSchema,
  type CreatePettyCashFundInput,
} from "@/lib/validation/petty-cash";

import { createPettyCashFundAction } from "./actions";

export type CustodianOption = { id: string; label: string };

type FormValues = {
  location_name: string;
  custodian_employee_id: string;
  imprest_idr: string;
  min_balance_idr: string;
  opening_balance_idr: string;
};

const DEFAULT_VALUES: FormValues = {
  location_name: "",
  custodian_employee_id: "",
  imprest_idr: "",
  min_balance_idr: "",
  opening_balance_idr: "",
};

export function NewFundSheet({
  custodians,
}: {
  custodians: CustodianOption[];
}) {
  const t = useTranslations("pettyCash");
  const tf = useTranslations("pettyCash.fundForm");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: async (values) => {
      const parsed = createPettyCashFundSchema.safeParse({
        location_name: values.location_name,
        custodian_employee_id: values.custodian_employee_id,
        imprest_idr: Number(values.imprest_idr.replaceAll(/\D/g, "")),
        min_balance_idr: Number(values.min_balance_idr.replaceAll(/\D/g, "")),
        opening_balance_idr: values.opening_balance_idr
          ? Number(values.opening_balance_idr.replaceAll(/\D/g, ""))
          : undefined,
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
    const payload: CreatePettyCashFundInput = {
      location_name: values.location_name,
      custodian_employee_id: values.custodian_employee_id,
      imprest_idr: Number(values.imprest_idr.replaceAll(/\D/g, "")),
      min_balance_idr: Number(values.min_balance_idr.replaceAll(/\D/g, "")),
      opening_balance_idr: values.opening_balance_idr
        ? Number(values.opening_balance_idr.replaceAll(/\D/g, ""))
        : undefined,
    };
    startTransition(async () => {
      const result = await createPettyCashFundAction(payload);
      if (result.ok) {
        toast.success(tf("created"));
        form.reset(DEFAULT_VALUES);
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  const hasCustodians = custodians.length > 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" disabled={!hasCustodians}>
            <Plus className="size-4" />
            {t("newFund")}
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

        {!hasCustodians ? (
          <div className="px-4 text-sm text-muted-foreground">
            {tf("needsCustodian")}
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
            >
              <FormField
                control={form.control}
                name="location_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("location")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={tf("locationPlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="custodian_employee_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("custodian")}</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={tf("custodianPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {custodians.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="imprest_idr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tf("imprest")}</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="numeric" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="min_balance_idr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tf("minBalance")}</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="numeric" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="opening_balance_idr"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("openingBalance")}</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="numeric" placeholder={tf("openingBalanceHint")} />
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
        )}
      </SheetContent>
    </Sheet>
  );
}
