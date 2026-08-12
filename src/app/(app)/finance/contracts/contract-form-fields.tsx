"use client";

/**
 * Shared form-body for BPO contract create/edit sheets.
 * See `client-form-fields.tsx` for the same pattern applied to clients.
 */

import type { UseFormReturn } from "react-hook-form";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
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
import { CONTRACT_STATUSES } from "@/lib/validation/client";

export function ContractFormFields({
  form,
  clientPicker,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  /** Optional pre-rendered client picker (only used on the create sheet). */
  clientPicker?: React.ReactNode;
}) {
  const tf = useTranslations("contracts.form");
  const tStatus = useTranslations("contracts.status");

  return (
    <>
      {clientPicker ?? null}

      <FormField
        control={form.control}
        name="contract_number"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("contractNumber")}</FormLabel>
            <FormControl>
              <Input
                placeholder="MSA-2026-001"
                autoComplete="off"
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="mrr_amount_idr"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("mrrAmount")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="15000000"
                  value={field.value ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    field.onChange(v === "" ? undefined : Number(v));
                  }}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              </FormControl>
              <FormMessage />
              <p className="text-xs text-muted-foreground">
                {tf("mrrHint")}
              </p>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("status")}</FormLabel>
              <Select
                value={field.value ?? "DRAFT"}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {CONTRACT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tStatus(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="start_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("startDate")}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="end_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("endDate")}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              </FormControl>
              <FormMessage />
              <p className="text-xs text-muted-foreground">
                {tf("endDateHint")}
              </p>
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("notes")}</FormLabel>
            <FormControl>
              <Textarea
                rows={3}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                placeholder={tf("notesPlaceholder")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
