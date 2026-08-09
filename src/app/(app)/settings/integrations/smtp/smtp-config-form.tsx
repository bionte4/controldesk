"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, Mail, PowerOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  saveSmtpConfigSchema,
  type SaveSmtpConfigInput,
} from "@/lib/validation/smtp-admin";

import {
  deactivateSmtpConfigAction,
  saveSmtpConfigAction,
} from "./actions";

const DEFAULT_VALUES: SaveSmtpConfigInput = {
  provider: "SMTP",
  host: "",
  // 587 = SMTP submission (STARTTLS). Modern default; every mainstream
  // relay (Gmail, Zoho, SES SMTP, Postmark SMTP, self-hosted) accepts
  // it. Dev/mailpit users override to 1025.
  port: 587,
  secure: null,
  username: "",
  password: "",
  from_address: "",
  from_name: "",
  reply_to: "",
};

type Props = {
  /**
   * Current DB state (masked). `null` when no row exists. Password is
   * never round-tripped to the client — only the flag whether one is
   * currently stored (`hasUsername`) so the form can render an
   * accurate "leave blank to keep current" hint.
   */
  current:
    | {
        host: string;
        port: number;
        secure: boolean | null;
        fromAddress: string;
        fromName: string | null;
        replyTo: string | null;
        hasUsername: boolean;
        isActive: boolean;
      }
    | null;
};

/**
 * Tenant SMTP admin form. Verify-before-save via the server action:
 * `verifySmtpCredentials` runs nodemailer's `verify()` (real TCP+TLS
 * handshake against the relay) so bad credentials or the wrong port
 * are caught here — not the next time the digest cron fires.
 *
 * Password rotation UX: the field is a password input that is always
 * blank on load. If the admin leaves it blank on submit, the existing
 * encrypted password is preserved (see actions.ts). This lets an
 * admin update host / from / reply-to without re-typing the secret.
 */
export function SmtpConfigForm({ current }: Props) {
  const t = useTranslations("smtpAdmin.form");
  const [isSaving, startSave] = React.useTransition();
  const [isDeactivating, startDeactivate] = React.useTransition();

  const initialValues = React.useMemo<SaveSmtpConfigInput>(
    () => ({
      provider: "SMTP",
      host: current?.host ?? "",
      port: current?.port ?? 587,
      secure: current?.secure ?? null,
      username: "",
      password: "",
      from_address: current?.fromAddress ?? "",
      from_name: current?.fromName ?? "",
      reply_to: current?.replyTo ?? "",
    }),
    [current],
  );

  const form = useForm<SaveSmtpConfigInput>({
    defaultValues: initialValues,
    resolver: zodResolver(saveSmtpConfigSchema) as unknown as Resolver<
      SaveSmtpConfigInput
    >,
  });

  function onSubmit(values: SaveSmtpConfigInput) {
    startSave(async () => {
      // Normalise empty strings to nulls for optional fields so the
      // action's "leave blank to preserve" logic works as intended.
      const payload: SaveSmtpConfigInput = {
        ...values,
        username:
          values.username && values.username.length > 0
            ? values.username
            : null,
        password:
          values.password && values.password.length > 0
            ? values.password
            : null,
        from_name:
          values.from_name && values.from_name.length > 0
            ? values.from_name
            : null,
        reply_to:
          values.reply_to && values.reply_to.length > 0
            ? values.reply_to
            : null,
      };

      const result = await saveSmtpConfigAction(payload);
      if (result.ok) {
        toast.success(t("toast.savedOk"));
        // Wipe secrets on success; preserve everything else so admin
        // can confirm what landed.
        form.reset({
          provider: "SMTP",
          host: result.data.host,
          port: result.data.port,
          secure: values.secure ?? null,
          username: "",
          password: "",
          from_address: result.data.fromAddress,
          from_name: values.from_name ?? "",
          reply_to: values.reply_to ?? "",
        });
      } else {
        toast.error(result.reason);
      }
    });
  }

  function onDeactivate() {
    if (!window.confirm(t("deactivateConfirm"))) return;
    startDeactivate(async () => {
      const result = await deactivateSmtpConfigAction({});
      if (result.ok) {
        toast.success(t("toast.deactivatedOk"));
        form.reset(DEFAULT_VALUES);
      } else {
        toast.error(result.reason);
      }
    });
  }

  const busy = isSaving || isDeactivating;

  return (
    <Card className="glass">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-primary" aria-hidden />
          <h2 className="font-semibold">{t("title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t("description")}</p>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.host")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t("fields.hostPlaceholder")}
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription>{t("fields.hostHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.port")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={65535}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? undefined
                              : Number.parseInt(e.target.value, 10),
                          )
                        }
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription>{t("fields.portHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.username")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("fields.usernamePlaceholder")}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("fields.usernameHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.password")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("fields.passwordPlaceholder")}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>
                    {current?.hasUsername
                      ? t("fields.passwordHintUpdate")
                      : t("fields.passwordHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="from_address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.fromAddress")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t("fields.fromAddressPlaceholder")}
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("fields.fromAddressHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="from_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.fromName")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t("fields.fromNamePlaceholder")}
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("fields.fromNameHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="reply_to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.replyTo")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      type="email"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("fields.replyToPlaceholder")}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>{t("fields.replyToHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy}>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                {current ? t("actions.update") : t("actions.save")}
              </Button>

              {current && current.isActive ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onDeactivate}
                  disabled={busy}
                >
                  {isDeactivating ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <PowerOff className="size-4" aria-hidden />
                  )}
                  {t("actions.deactivate")}
                </Button>
              ) : null}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
