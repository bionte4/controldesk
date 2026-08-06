"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  portalChangePasswordSchema,
  type PortalChangePasswordInput,
} from "@/lib/validation/portal-change-password";

import { portalChangePasswordAction } from "../../actions";

export function PortalChangePasswordForm() {
  const t = useTranslations("portal.changePassword");
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PortalChangePasswordInput>({
    resolver: zodResolver(portalChangePasswordSchema),
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = await portalChangePasswordAction(values);
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

      <PwField
        id="portal-current"
        label={t("currentPassword")}
        autoComplete="current-password"
        register={register("current_password")}
        error={errors.current_password?.message}
      />
      <PwField
        id="portal-new"
        label={t("newPassword")}
        autoComplete="new-password"
        register={register("new_password")}
        error={errors.new_password?.message}
        hint={t("policyHint")}
      />
      <PwField
        id="portal-confirm"
        label={t("confirmPassword")}
        autoComplete="new-password"
        register={register("confirm_password")}
        error={errors.confirm_password?.message}
      />

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

function PwField(props: {
  id: string;
  label: string;
  autoComplete: string;
  register: ReturnType<
    ReturnType<typeof useForm<PortalChangePasswordInput>>["register"]
  >;
  error?: string;
  hint?: string;
}) {
  const { id, label, autoComplete, register, error, hint } = props;
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Lock
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
        />
        <Input
          id={id}
          type="password"
          autoComplete={autoComplete}
          className="pl-9"
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [errorId, hintId].filter(Boolean).join(" ") || undefined
          }
          {...register}
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
