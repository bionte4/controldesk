"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

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
  updateClientSchema,
  type CreateClientInput,
  type UpdateClientInput,
} from "@/lib/validation/client";

import { ClientFormFields } from "../client-form-fields";
import { updateClientAction } from "../actions";

/**
 * Edit sheet for an existing client (rules §6).
 *
 * Reuses `ClientFormFields` to guarantee UI parity with the "New client"
 * sheet. Wraps everything in `updateClientSchema` (partial + `id` required)
 * so unchanged fields are simply not sent. On success we `router.refresh()`
 * the RSC — the server action already revalidates the route.
 */
export function EditClientSheet({
  client,
}: {
  client: {
    id: string;
    name: string;
    industry: string | null;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    status: "PROSPECT" | "ACTIVE" | "ON_HOLD" | "CHURNED";
    contract_number: string | null;
    project_code: string | null;
    notes: string | null;
  };
}) {
  const tf = useTranslations("clients.form");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const router = useRouter();

  const defaults: CreateClientInput = React.useMemo(
    () => ({
      name: client.name,
      industry: client.industry ?? undefined,
      contact_name: client.contact_name ?? undefined,
      contact_email: client.contact_email ?? undefined,
      contact_phone: client.contact_phone ?? undefined,
      status: client.status,
      contract_number: client.contract_number ?? undefined,
      project_code: client.project_code ?? undefined,
      notes: client.notes ?? undefined,
    }),
    [client],
  );

  const form = useForm<CreateClientInput>({
    resolver: zodResolver(
      updateClientSchema.omit({ id: true }),
    ) as unknown as Resolver<CreateClientInput>,
    defaultValues: defaults,
  });

  React.useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  function onSubmit(values: CreateClientInput) {
    startTransition(async () => {
      const payload: UpdateClientInput = { id: client.id, ...values };
      const result = await updateClientAction(payload);
      if (result.ok) {
        toast.success(tf("updated", { name: result.data.name }));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant="outline">
            <Pencil className="size-4" />
            {tf("editButton")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("editTitle")}</SheetTitle>
          <SheetDescription>{tf("editDescription")}</SheetDescription>
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
                {tf("saveChanges")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
