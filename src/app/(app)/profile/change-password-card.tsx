"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
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
  changePasswordSchema,
  type ChangePasswordInput,
} from "@/lib/validation/profile";

import { changePasswordAction } from "./actions";

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function ChangePasswordCard() {
  const t = useTranslations("profile.password") as unknown as Translator;
  const [isPending, startTransition] = React.useTransition();
  const [showPasswords, setShowPasswords] = React.useState(false);

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(
      changePasswordSchema,
    ) as unknown as Resolver<ChangePasswordInput>,
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
    mode: "onBlur",
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const res = await changePasswordAction(values);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(t("changedToast"));
      form.reset({
        current_password: "",
        new_password: "",
        confirm_password: "",
      });
    });
  });

  const inputType = showPasswords ? "text" : "password";

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4">
        <FormField
          control={form.control}
          name="current_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("current")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  type={inputType}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  autoComplete="current-password"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="new_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("new")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  type={inputType}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  autoComplete="new-password"
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">{t("hint")}</p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirm_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("confirm")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  type={inputType}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  autoComplete="new-password"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowPasswords((s) => !s)}
            aria-pressed={showPasswords}
            aria-label={showPasswords ? t("hideAria") : t("showAria")}
          >
            {showPasswords ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
            {showPasswords ? t("hide") : t("show")}
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            {t("submit")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
