"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  createContractSchema,
  type CreateContractInput,
} from "@/lib/validation/client";

import { ContractFormFields } from "./contract-form-fields";
import { createBpoContractAction } from "./actions";

type ClientOption = { id: string; name: string };

const DEFAULT_VALUES: Partial<CreateContractInput> = {
  contract_number: "",
  mrr_amount_idr: undefined,
  start_date: "",
  end_date: undefined,
  status: "DRAFT",
  notes: undefined,
};

export function NewContractSheet({
  clients,
  presetClientId,
}: {
  clients: ClientOption[];
  /** If set, the client picker is pre-selected and hidden. */
  presetClientId?: string;
}) {
  const t = useTranslations("contracts");
  const tf = useTranslations("contracts.form");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const router = useRouter();

  const form = useForm<CreateContractInput>({
    resolver: zodResolver(createContractSchema) as unknown as Resolver<CreateContractInput>,
    defaultValues: {
      ...DEFAULT_VALUES,
      client_id: presetClientId ?? "",
    } as CreateContractInput,
  });

  function onSubmit(values: CreateContractInput) {
    startTransition(async () => {
      const result = await createBpoContractAction(values);
      if (result.ok) {
        toast.success(
          tf("created", { number: result.data.contract_number }),
        );
        form.reset({
          ...DEFAULT_VALUES,
          client_id: presetClientId ?? "",
        } as CreateContractInput);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  }

  const clientPicker = presetClientId ? null : (
    <FormField
      control={form.control}
      name="client_id"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{tf("client")}</FormLabel>
          <Select
            value={field.value ?? ""}
            onValueChange={field.onChange}
          >
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tf("clientPlaceholder")} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" />
            {t("newContract")}
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
            <ContractFormFields form={form} clientPicker={clientPicker} />

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
