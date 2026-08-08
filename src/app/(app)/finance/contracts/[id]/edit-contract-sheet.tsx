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
  editContractFormSchema,
  type EditContractFormInput,
  type UpdateContractInput,
} from "@/lib/validation/client";

import { ContractFormFields } from "../contract-form-fields";
import { updateBpoContractAction } from "../actions";

/**
 * Edit sheet for an existing BPO contract.
 *
 * We reuse the *create* schema locally (all fields required minus `client_id`)
 * for the form itself so the UX matches New sheet exactly. Submit then
 * repackages into `UpdateContractInput` for the server action — that path
 * uses the partial `updateContractSchema` to enable per-column patching in
 * the DB.
 */
export function EditContractSheet({
  contract,
}: {
  contract: {
    id: string;
    contract_number: string;
    mrr_amount_idr: number;
    start_date: string; // ISO date
    end_date: string | null;
    status: "DRAFT" | "ACTIVE" | "ENDED" | "RENEWED" | "TERMINATED";
    notes: string | null;
    client_id: string;
  };
}) {
  const tf = useTranslations("contracts.form");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const router = useRouter();

  const defaults: EditContractFormInput = React.useMemo(
    () => ({
      contract_number: contract.contract_number,
      mrr_amount_idr: contract.mrr_amount_idr,
      start_date: contract.start_date,
      end_date: contract.end_date ?? undefined,
      status: contract.status,
      notes: contract.notes ?? undefined,
    }),
    [contract],
  );

  const form = useForm<EditContractFormInput>({
    // `editContractFormSchema` = createContractBaseSchema.omit({client_id}) +
    // date-order refinement. This side-steps Zod's rule that .omit() cannot
    // be called on a schema that already carries a refinement.
    resolver: zodResolver(editContractFormSchema) as unknown as Resolver<EditContractFormInput>,
    defaultValues: defaults,
  });

  React.useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  function onSubmit(values: EditContractFormInput) {
    startTransition(async () => {
      const payload: UpdateContractInput = {
        id: contract.id,
        contract_number: values.contract_number,
        mrr_amount_idr: values.mrr_amount_idr,
        start_date: values.start_date,
        // "" from a cleared date input → null (open-ended contract).
        end_date: values.end_date && values.end_date !== ""
          ? values.end_date
          : null,
        status: values.status,
        notes: values.notes && values.notes !== "" ? values.notes : null,
      };
      const result = await updateBpoContractAction(payload);
      if (result.ok) {
        toast.success(
          tf("updated", { number: result.data.contract_number }),
        );
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
            <ContractFormFields form={form} />

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
