"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
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
  createClientSchema,
  type CreateClientInput,
} from "@/lib/validation/client";

import { ClientFormFields } from "./client-form-fields";
import { createClientAction } from "./actions";

const DEFAULT_VALUES: CreateClientInput = {
  name: "",
  industry: undefined,
  contact_name: undefined,
  contact_email: undefined,
  contact_phone: undefined,
  status: "PROSPECT",
  contract_number: undefined,
  project_code: undefined,
  notes: undefined,
};

export function NewClientSheet() {
  const t = useTranslations("clients");
  const tf = useTranslations("clients.form");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema) as unknown as Resolver<CreateClientInput>,
    defaultValues: DEFAULT_VALUES,
  });

  function onSubmit(values: CreateClientInput) {
    startTransition(async () => {
      const result = await createClientAction(values);
      if (result.ok) {
        toast.success(tf("created", { name: result.data.name }));
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
            {t("newClient")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("createTitle")}</SheetTitle>
          <SheetDescription>{tf("createDescription")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <ClientFormFields form={form} />

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
