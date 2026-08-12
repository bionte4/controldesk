"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, PowerOff, Send } from "lucide-react";
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
  saveTelegramBotSchema,
  type SaveTelegramBotInput,
} from "@/lib/validation/telegram-admin";

import {
  deactivateTelegramBotAction,
  saveTelegramBotAction,
} from "./actions";

const DEFAULT_VALUES: SaveTelegramBotInput = {
  bot_username: "",
  bot_token: "",
};

type Props = {
  /**
   * Current DB state. `null` when no row exists yet.
   * We deliberately do NOT accept the plaintext token here — the
   * server-only loader is the sole custodian of the decrypted value.
   */
  current:
    | {
        botUsername: string;
        isActive: boolean;
        lastError: string | null;
      }
    | null;
};

/**
 * Admin registration form for the tenant Telegram bot.
 *
 * UX notes:
 *   * Bot token field never pre-fills, never renders the existing
 *     value. Admins wanting to rotate a token must paste the fresh
 *     one from BotFather — safer than showing a masked "current"
 *     shape that could tempt a partial edit.
 *   * On submit, the server action first calls Telegram's `getMe`.
 *     Failure surfaces the API description verbatim (e.g.
 *     "Unauthorized" for a revoked token) so admins know what to
 *     fix without guessing.
 *   * "Deactivate" is a soft-close: row stays in the DB (audit +
 *     `last_error` survive) but outbound dispatch stops.
 */
export function TelegramBotForm({ current }: Props) {
  const t = useTranslations("telegramBotAdmin.form");
  const [isSaving, startSave] = React.useTransition();
  const [isDeactivating, startDeactivate] = React.useTransition();

  const form = useForm<SaveTelegramBotInput>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(saveTelegramBotSchema) as unknown as Resolver<
      SaveTelegramBotInput
    >,
  });

  function onSubmit(values: SaveTelegramBotInput) {
    startSave(async () => {
      const result = await saveTelegramBotAction(values);
      if (result.ok) {
        toast.success(
          t("toast.savedOk", { botUsername: result.data.botUsername }),
        );
        // Wipe the token field so it never lingers in the DOM after
        // a successful write. Username stays for visual confirmation.
        form.reset({
          bot_username: result.data.botUsername,
          bot_token: "",
        });
      } else {
        toast.error(result.reason);
      }
    });
  }

  function onDeactivate() {
    if (!window.confirm(t("deactivateConfirm"))) return;
    startDeactivate(async () => {
      const result = await deactivateTelegramBotAction({});
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
          <Send className="size-4 text-primary" aria-hidden />
          <h2 className="font-semibold">{t("title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t("description")}</p>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="bot_username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.botUsername")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("fields.botUsernamePlaceholder")}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("fields.botUsernameHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bot_token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.botToken")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("fields.botTokenPlaceholder")}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>
                    {current
                      ? t("fields.botTokenHintUpdate")
                      : t("fields.botTokenHint")}
                  </FormDescription>
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
