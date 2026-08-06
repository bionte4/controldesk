"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { portalLoginAction } from "../../actions";

type FormValues = { email: string; password: string };

export function PortalLoginForm() {
  const t = useTranslations("portal.login");
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = await portalLoginAction(values);
      if (result.ok) {
        toast.success(t("successToast"));
        router.replace("/portal");
        router.refresh();
      } else {
        setError(result.reason);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="portal-email">{t("email")}</Label>
        <div className="relative">
          <Mail
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
          />
          <Input
            id="portal-email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            className="pl-9"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "portal-email-error" : undefined}
            {...register("email", { required: t("emailRequired") })}
          />
        </div>
        {errors.email ? (
          <p id="portal-email-error" className="text-xs text-destructive">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="portal-password">{t("password")}</Label>
        <div className="relative">
          <Lock
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
          />
          <Input
            id="portal-password"
            type="password"
            autoComplete="current-password"
            placeholder={t("passwordPlaceholder")}
            className="pl-9"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={
              errors.password ? "portal-password-error" : undefined
            }
            {...register("password", { required: t("passwordRequired") })}
          />
        </div>
        {errors.password ? (
          <p id="portal-password-error" className="text-xs text-destructive">
            {errors.password.message}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {t("submitting")}
          </>
        ) : (
          t("submit")
        )}
      </Button>
    </form>
  );
}
