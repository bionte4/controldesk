"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from "@/lib/validation/profile";

import { updateProfileAction } from "./actions";

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function ProfileForm({
  initial,
}: {
  initial: UpdateProfileInput;
}) {
  const t = useTranslations("profile") as unknown as Translator;
  const tCommon = useTranslations("common") as unknown as Translator;
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(
      updateProfileSchema,
    ) as unknown as Resolver<UpdateProfileInput>,
    defaultValues: initial,
    mode: "onBlur",
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const res = await updateProfileAction(values);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(t("form.savedToast"));
      form.reset(values);
    });
  });

  const dirty = form.formState.isDirty;

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        className="grid gap-4 sm:grid-cols-2"
      >
        <FormField
          control={form.control}
          name="first_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("form.firstName")}{" "}
                <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  autoComplete="given-name"
                  maxLength={80}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="last_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("form.lastName")}</FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value || undefined)
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  autoComplete="family-name"
                  maxLength={80}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("form.phone")}</FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value || undefined)
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+62 812-3456-7890"
                  maxLength={32}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="date_of_birth"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("form.dateOfBirth")}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value || undefined)
                  }
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
          name="preferred_locale"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{t("form.preferredLocale")}</FormLabel>
              <Select
                value={field.value ?? ""}
                onValueChange={(v) =>
                  field.onChange(v ? (v as "id" | "en") : undefined)
                }
              >
                <FormControl>
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue
                      placeholder={t("form.preferredLocalePlaceholder")}
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="id">{t("locale.id")}</SelectItem>
                  <SelectItem value="en">{t("locale.en")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("form.preferredLocaleHint")}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="sm:col-span-2 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending || !dirty}
            onClick={() => form.reset(initial)}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={isPending || !dirty}
            aria-label={t("form.save")}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {t("form.save")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
