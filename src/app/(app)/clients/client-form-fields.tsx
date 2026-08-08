"use client";

/**
 * Shared form-field body for creating and updating clients.
 *
 * Consumed by:
 *   - NewClientSheet  (create flow)
 *   - EditClientSheet (update flow — pre-filled from `defaultValues`)
 *
 * Kept as a plain component (not a hook) so both sheets can decide their
 * own layout, submit label, and side-effects (toast, revalidate, redirect).
 */

import * as React from "react";
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
import {
  CLIENT_STATUSES,
  type CreateClientInput,
} from "@/lib/validation/client";

export function ClientFormFields({
  form,
}: {
  // The parent controls the schema (create vs update). We accept the widest
  // shape (CreateClientInput) since update is a partial superset.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
}) {
  const tf = useTranslations("clients.form");
  const tStatus = useTranslations("clients.status");

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("name")}</FormLabel>
            <FormControl>
              <Input
                placeholder={tf("namePlaceholder")}
                autoComplete="off"
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
        name="industry"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("industry")}</FormLabel>
            <FormControl>
              <Input
                placeholder={tf("industryPlaceholder")}
                autoComplete="off"
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

      <FormField
        control={form.control}
        name="status"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("status")}</FormLabel>
            <Select
              value={field.value ?? "PROSPECT"}
              onValueChange={field.onChange}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {CLIENT_STATUSES.map((s) => (
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="contact_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("contactName")}</FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  placeholder={tf("contactNamePlaceholder")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="contact_phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("contactPhone")}</FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  placeholder="+62 812 ..."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="contact_email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("contactEmail")}</FormLabel>
            <FormControl>
              <Input
                type="email"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                placeholder="ops@client.co.id"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="mt-2 border-t pt-4">
        <p className="text-sm font-medium">{tf("contractInfoTitle")}</p>
        <p className="text-muted-foreground text-xs">
          {tf("contractInfoHint")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="contract_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("contractNumber")}</FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  placeholder={tf("contractNumberPlaceholder")}
                  autoComplete="off"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="project_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("projectCode")}</FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  placeholder={tf("projectCodePlaceholder")}
                  autoComplete="off"
                />
              </FormControl>
              <FormMessage />
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

// Re-export the input type for parent consumption.
export type { CreateClientInput };
