"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Copy, KeyRound, Plus, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createClientPortalUserSchema,
  type CreateClientPortalUserInput,
} from "@/lib/validation/client-portal-user";

import {
  createClientPortalUserAction,
  resetClientPortalUserPasswordAction,
  updateClientPortalUserStatusAction,
} from "./actions";

type Row = {
  id: string;
  email: string;
  full_name: string;
  status: string;
};

export function PortalUsersManager(props: {
  clientId: string;
  clientName: string;
  row?: Row;
  rowMode?: boolean;
}) {
  const { clientId, row, rowMode } = props;
  if (rowMode && row) {
    return <RowActions clientId={clientId} row={row} />;
  }
  return <CreateAction clientId={clientId} />;
}

// ---------------------------------------------------------------------------
// Create — invite a new portal user, show temp password ONCE.
// ---------------------------------------------------------------------------
function CreateAction({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.portalUsers.create");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [tempPassword, setTempPassword] = React.useState<{
    email: string;
    password: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateClientPortalUserInput>({
    resolver: zodResolver(createClientPortalUserSchema),
    defaultValues: { clientId, email: "", full_name: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await createClientPortalUserAction({ ...values, clientId });
      if (result.ok) {
        setTempPassword({
          email: result.data.email,
          password: result.data.temp_password,
        });
        reset({ clientId, email: "", full_name: "" });
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setTempPassword(null);
            reset({ clientId, email: "", full_name: "" });
          }
        }}
      >
        <DialogTrigger
          render={
            <Button>
              <Plus className="size-4" />
              {t("cta")}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("subtitle")}</DialogDescription>
          </DialogHeader>

          {tempPassword ? (
            <TempPasswordPanel
              email={tempPassword.email}
              password={tempPassword.password}
              onClose={() => {
                setTempPassword(null);
                setOpen(false);
              }}
            />
          ) : (
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="cpu-name">{t("name")}</Label>
                <Input
                  id="cpu-name"
                  autoComplete="off"
                  aria-invalid={errors.full_name ? true : undefined}
                  {...register("full_name")}
                />
                {errors.full_name ? (
                  <p className="text-xs text-destructive">
                    {errors.full_name.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cpu-email">{t("email")}</Label>
                <Input
                  id="cpu-email"
                  type="email"
                  autoComplete="off"
                  aria-invalid={errors.email ? true : undefined}
                  {...register("email")}
                />
                {errors.email ? (
                  <p className="text-xs text-destructive">
                    {errors.email.message}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? t("submitting") : t("submit")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row actions — reset password + toggle status.
// ---------------------------------------------------------------------------
function RowActions({ clientId: _clientId, row }: { clientId: string; row: Row }) {
  const t = useTranslations("clients.portalUsers.row");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [reset, setReset] = React.useState<{ password: string } | null>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);

  const isActive = row.status === "ACTIVE" || row.status === "PENDING_ACTIVATION";
  const nextStatus: "ACTIVE" | "DISABLED" = isActive ? "DISABLED" : "ACTIVE";

  function doReset() {
    startTransition(async () => {
      const result = await resetClientPortalUserPasswordAction({
        clientPortalUserId: row.id,
      });
      if (result.ok) {
        setReset({ password: result.data.temp_password });
        router.refresh();
      } else {
        toast.error(result.reason);
        setResetOpen(false);
      }
    });
  }

  function doToggle() {
    startTransition(async () => {
      const result = await updateClientPortalUserStatusAction({
        clientPortalUserId: row.id,
        status: nextStatus,
      });
      if (result.ok) {
        toast.success(
          nextStatus === "ACTIVE" ? t("enabled") : t("disabled"),
        );
        setStatusOpen(false);
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      {/* Reset password */}
      <Dialog
        open={resetOpen}
        onOpenChange={(next) => {
          setResetOpen(next);
          if (!next) setReset(null);
        }}
      >
        <DialogTrigger
          render={
            <Button size="sm" variant="ghost" aria-label={t("resetPassword")}>
              <KeyRound className="size-4" />
              <span className="sr-only sm:not-sr-only">
                {t("resetPassword")}
              </span>
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resetTitle")}</DialogTitle>
            <DialogDescription>
              {t("resetSubtitle", { email: row.email })}
            </DialogDescription>
          </DialogHeader>
          {reset ? (
            <TempPasswordPanel
              email={row.email}
              password={reset.password}
              onClose={() => {
                setReset(null);
                setResetOpen(false);
              }}
            />
          ) : (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setResetOpen(false)}
                disabled={pending}
              >
                {t("cancel")}
              </Button>
              <Button onClick={doReset} disabled={pending}>
                {pending ? t("submitting") : t("confirmReset")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Enable / Disable */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              aria-label={isActive ? t("disable") : t("enable")}
            >
              {isActive ? (
                <PowerOff className="size-4" />
              ) : (
                <Power className="size-4" />
              )}
              <span className="sr-only sm:not-sr-only">
                {isActive ? t("disable") : t("enable")}
              </span>
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isActive ? t("disableTitle") : t("enableTitle")}
            </DialogTitle>
            <DialogDescription>
              {isActive
                ? t("disableSubtitle", { email: row.email })
                : t("enableSubtitle", { email: row.email })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStatusOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button onClick={doToggle} disabled={pending}>
              {pending
                ? t("submitting")
                : isActive
                  ? t("confirmDisable")
                  : t("confirmEnable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable panel that displays the newly generated one-time password.
// ---------------------------------------------------------------------------
function TempPasswordPanel({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const t = useTranslations("clients.portalUsers.tempPassword");
  const [copied, setCopied] = React.useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast.success(t("copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
        {t("warning")}
      </div>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="label-meta text-muted-foreground">{t("emailLabel")}</dt>
          <dd className="tabular-nums font-medium">{email}</dd>
        </div>
        <div>
          <dt className="label-meta text-muted-foreground">
            {t("passwordLabel")}
          </dt>
          <dd className="flex items-center gap-2">
            <code className="rounded-md bg-muted/50 px-2 py-1 text-base font-mono tabular-nums">
              {password}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopy}
              aria-label={t("copy")}
            >
              <Copy className="size-4" />
              {copied ? t("copied") : t("copy")}
            </Button>
          </dd>
        </div>
      </dl>
      <DialogFooter>
        <Button onClick={onClose}>{t("done")}</Button>
      </DialogFooter>
    </div>
  );
}
