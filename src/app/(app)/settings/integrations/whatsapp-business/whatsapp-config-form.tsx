"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, MessageCircle, PowerOff } from "lucide-react";
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
import type { WhatsAppProvider } from "@/lib/integrations/whatsapp";
import {
  saveWhatsAppConfigSchema,
  type SaveWhatsAppConfigInput,
} from "@/lib/validation/whatsapp-admin";

import {
  deactivateWhatsAppConfigAction,
  saveWhatsAppConfigAction,
} from "./actions";

const DEFAULT_VALUES: SaveWhatsAppConfigInput = {
  provider: "FONNTE",
  phone_number_id: "",
  api_token: "",
  account_sid: null,
  webhook_verify_token: null,
};

type Props = {
  /**
   * Current DB state. `null` when no row exists. `provider` is kept
   * on the type so the display badge can render correctly for legacy
   * TWILIO / META_CLOUD rows (dormant code paths), but the form
   * only writes FONNTE rows.
   */
  current:
    | {
        provider: WhatsAppProvider;
        phoneNumberId: string;
        isActive: boolean;
        lastError: string | null;
      }
    | null;
};

/**
 * Fonnte-only admin registration form for the tenant WhatsApp
 * channel. Two fields:
 *   * Business phone   — WhatsApp number paired to the Fonnte
 *                        device (for display / audit; Fonnte routes
 *                        by device token, not by number).
 *   * Device token     — the API key from
 *                        https://md.fonnte.com/new/device.
 *
 * On submit the server action calls Fonnte's `/device` endpoint to
 * verify the token before persisting. Failure surfaces the Fonnte
 * `reason` string via toast.
 */
export function WhatsAppConfigForm({ current }: Props) {
  const t = useTranslations("whatsappAdmin.form");
  const [isSaving, startSave] = React.useTransition();
  const [isDeactivating, startDeactivate] = React.useTransition();

  const initialValues = React.useMemo<SaveWhatsAppConfigInput>(
    () => ({
      provider: "FONNTE",
      // Preserve the current phone (if any) so admins updating just
      // the token don't have to retype the number.
      phone_number_id: current?.phoneNumberId ?? "",
      api_token: "",
      account_sid: null,
      webhook_verify_token: null,
    }),
    [current],
  );

  const form = useForm<SaveWhatsAppConfigInput>({
    defaultValues: initialValues,
    resolver: zodResolver(saveWhatsAppConfigSchema) as unknown as Resolver<
      SaveWhatsAppConfigInput
    >,
  });

  function onSubmit(values: SaveWhatsAppConfigInput) {
    startSave(async () => {
      const result = await saveWhatsAppConfigAction(values);
      if (result.ok) {
        toast.success(t("toast.savedOk"));
        // Wipe the token field on success. Keep the phone visible
        // so admins can confirm what landed.
        form.reset({
          provider: "FONNTE",
          phone_number_id: result.data.phoneNumberId,
          api_token: "",
          account_sid: null,
          webhook_verify_token: null,
        });
      } else {
        toast.error(result.reason);
      }
    });
  }

  function onDeactivate() {
    if (!window.confirm(t("deactivateConfirm"))) return;
    startDeactivate(async () => {
      const result = await deactivateWhatsAppConfigAction({});
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
          <MessageCircle className="size-4 text-primary" aria-hidden />
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
              name="phone_number_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.phoneFonnte")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("fields.phoneFonntePlaceholder")}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("fields.phoneFonnteHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="api_token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.deviceToken")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("fields.deviceTokenPlaceholder")}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>
                    {current
                      ? t("fields.deviceTokenHintUpdate")
                      : t("fields.deviceTokenHint")}
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
