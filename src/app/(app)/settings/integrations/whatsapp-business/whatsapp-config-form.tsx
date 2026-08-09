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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WhatsAppProvider } from "@/lib/integrations/whatsapp";
import {
  saveWhatsAppConfigSchema,
  type SaveWhatsAppConfigInput,
} from "@/lib/validation/whatsapp-admin";

import {
  deactivateWhatsAppConfigAction,
  saveWhatsAppConfigAction,
} from "./actions";

/**
 * Only providers we can save. META_CLOUD stays out — its adapter still
 * returns NOT_IMPLEMENTED at send time (see whatsapp/client.ts), so we
 * don't want admins to pick it and then have every message silently
 * fail. Legacy META_CLOUD rows still render (see hub tile), they just
 * can't be re-saved through this form.
 */
type SelectableProvider = Extract<WhatsAppProvider, "FONNTE" | "TWILIO">;
const SELECTABLE_PROVIDERS: readonly SelectableProvider[] = [
  "FONNTE",
  "TWILIO",
] as const;

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
   * META_CLOUD rows even though the form can only write FONNTE / TWILIO.
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
 * Tenant WhatsApp channel admin — provider picker with conditional
 * fields per provider:
 *
 *   FONNTE (Indonesian device-token gateway)
 *     - Phone number (paired WhatsApp number, informational)
 *     - Device token (from https://md.fonnte.com/new/device)
 *
 *   TWILIO (official partner)
 *     - WhatsApp Business number in E.164 form
 *     - Auth Token (from console dashboard)
 *     - Account SID (AC + 32 hex chars)
 *
 * On submit the server action calls the provider-specific verify
 * endpoint (Fonnte `/device` or Twilio `/Accounts/{sid}.json`) BEFORE
 * persisting. Failure surfaces the provider's error string via toast.
 */
export function WhatsAppConfigForm({ current }: Props) {
  const t = useTranslations("whatsappAdmin.form");
  const tProviders = useTranslations("whatsappAdmin.form.providers");
  const [isSaving, startSave] = React.useTransition();
  const [isDeactivating, startDeactivate] = React.useTransition();

  // Seed the picker from the current row if it's one we support. Legacy
  // META_CLOUD rows land the user on the FONNTE branch by default (they
  // still see the badge on the status card so nothing is destroyed on
  // read); saving from this form will write a fresh FONNTE row.
  const initialProvider: SelectableProvider =
    current?.provider === "TWILIO" ? "TWILIO" : "FONNTE";

  const initialValues = React.useMemo<SaveWhatsAppConfigInput>(
    () =>
      initialProvider === "TWILIO"
        ? {
            provider: "TWILIO",
            phone_number_id:
              current?.provider === "TWILIO" ? current.phoneNumberId : "",
            api_token: "",
            account_sid: "",
            webhook_verify_token: null,
          }
        : {
            provider: "FONNTE",
            phone_number_id:
              current?.provider === "FONNTE" ? current.phoneNumberId : "",
            api_token: "",
            account_sid: null,
            webhook_verify_token: null,
          },
    [current, initialProvider],
  );

  const form = useForm<SaveWhatsAppConfigInput>({
    defaultValues: initialValues,
    resolver: zodResolver(saveWhatsAppConfigSchema) as unknown as Resolver<
      SaveWhatsAppConfigInput
    >,
  });

  // Watch provider so labels + conditional fields react instantly.
  const provider = form.watch("provider") as SelectableProvider;

  function onProviderChange(next: SelectableProvider) {
    // Reset only when swapping providers to avoid stray Twilio SID
    // showing up in a Fonnte payload (Zod would reject it, but the
    // form UX is nicer if the fields wipe on switch). We keep the
    // phone number since it's the field an admin re-types least
    // (Twilio and Fonnte both use E.164 in practice).
    const keptPhone = form.getValues("phone_number_id");
    if (next === "TWILIO") {
      form.reset({
        provider: "TWILIO",
        phone_number_id: keptPhone,
        api_token: "",
        account_sid: "",
        webhook_verify_token: null,
      });
    } else {
      form.reset({
        provider: "FONNTE",
        phone_number_id: keptPhone,
        api_token: "",
        account_sid: null,
        webhook_verify_token: null,
      });
    }
  }

  function onSubmit(values: SaveWhatsAppConfigInput) {
    startSave(async () => {
      const result = await saveWhatsAppConfigAction(values);
      if (result.ok) {
        toast.success(t("toast.savedOk"));
        // Wipe secrets on success. Phone stays visible so admins can
        // confirm what landed.
        if (values.provider === "TWILIO") {
          form.reset({
            provider: "TWILIO",
            phone_number_id: result.data.phoneNumberId,
            api_token: "",
            account_sid: "",
            webhook_verify_token: null,
          });
        } else {
          form.reset({
            provider: "FONNTE",
            phone_number_id: result.data.phoneNumberId,
            api_token: "",
            account_sid: null,
            webhook_verify_token: null,
          });
        }
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
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.provider")}</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        if (v == null) return;
                        onProviderChange(v as SelectableProvider);
                      }}
                      disabled={busy}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SELECTABLE_PROVIDERS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {tProviders(`${p}.label`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    {tProviders(`${provider}.tagline`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone_number_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {tProviders(`${provider}.phoneLabel`)}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={tProviders(
                        `${provider}.phonePlaceholder`,
                      )}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>
                    {tProviders(`${provider}.phoneHint`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {provider === "TWILIO" ? (
              <FormField
                control={form.control}
                name="account_sid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tProviders("TWILIO.sidLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={tProviders("TWILIO.sidPlaceholder")}
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription>
                      {tProviders("TWILIO.sidHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <FormField
              control={form.control}
              name="api_token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {tProviders(`${provider}.tokenLabel`)}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={tProviders(
                        `${provider}.tokenPlaceholder`,
                      )}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>
                    {current
                      ? tProviders(`${provider}.tokenHintUpdate`)
                      : tProviders(`${provider}.tokenHint`)}
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
