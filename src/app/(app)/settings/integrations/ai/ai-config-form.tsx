"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, PowerOff, Sparkles } from "lucide-react";
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
import type { AiProvider } from "@/lib/integrations/ai";
import {
  saveAiConfigSchema,
  type SaveAiConfigInput,
} from "@/lib/validation/ai-admin";

import { deactivateAiConfigAction, saveAiConfigAction } from "./actions";

const PROVIDER_OPTIONS: readonly AiProvider[] = [
  "GOOGLE",
  "OPENAI",
  "ANTHROPIC",
  "OPENAI_COMPATIBLE",
  "DISABLED",
] as const;

/**
 * Suggested default model per provider. Users can change freely — the
 * verify-before-save call catches typos or unavailable models.
 *
 * Note on Google: we intentionally default to `gemini-flash-latest`
 * (the always-latest-stable alias) instead of a pinned major (e.g.
 * `gemini-2.5-flash`). Google routinely deprecates pinned versions and
 * returns a hard error for new users — the alias keeps new tenants
 * self-healing across those rollovers.
 */
const DEFAULT_MODEL: Record<AiProvider, string> = {
  GOOGLE: "gemini-flash-latest",
  OPENAI: "gpt-4o-mini",
  ANTHROPIC: "claude-sonnet-5",
  OPENAI_COMPATIBLE: "llama3.1:70b",
  DISABLED: "disabled",
};

type Props = {
  current:
    | {
        provider: AiProvider;
        modelId: string;
        baseUrl: string | null;
        dailyTokenCap: number | null;
        piiRedactionEnabled: boolean;
        insightFreshnessMin: number;
        hasApiKey: boolean;
        isActive: boolean;
      }
    | null;
};

/**
 * Tenant AI provider admin form. Discriminated Zod union keyed on
 * `provider` — the form reshapes fields on provider change:
 *
 *   GOOGLE / OPENAI / ANTHROPIC:
 *     - Model id (free text, provider-specific)
 *     - API key (required)
 *
 *   OPENAI_COMPATIBLE (Ollama, LM Studio, vLLM, Groq, Together AI):
 *     - Model id (free text)
 *     - Base URL (required — e.g. http://localhost:11434/v1)
 *     - API key (optional — Ollama on LAN typically has no auth)
 *     - PII redaction toggle (safe to disable only for fully-owned
 *       on-prem models)
 *
 *   DISABLED:
 *     - No fields. Signals to the resolver to skip AI entirely
 *       (deterministic mock takes over).
 *
 * Verify-before-save calls the provider with a trivial prompt
 * ("Respond with the single word: pong.") so bad credentials or wrong
 * `base_url` land as toast errors instead of runtime failures.
 */
export function AiConfigForm({ current }: Props) {
  const t = useTranslations("aiAdmin.form");
  const tProviders = useTranslations("aiAdmin.form.providers");
  const [isSaving, startSave] = React.useTransition();
  const [isDeactivating, startDeactivate] = React.useTransition();

  const initialProvider: AiProvider = current?.provider ?? "GOOGLE";

  const initialValues = React.useMemo<SaveAiConfigInput>(() => {
    const provider = initialProvider;
    const freshness = current?.insightFreshnessMin ?? 15;
    if (provider === "OPENAI_COMPATIBLE") {
      return {
        provider: "OPENAI_COMPATIBLE",
        model_id: current?.modelId ?? DEFAULT_MODEL[provider],
        api_key: null,
        base_url: current?.baseUrl ?? "",
        daily_token_cap: current?.dailyTokenCap ?? null,
        pii_redaction_enabled: current?.piiRedactionEnabled ?? true,
        insight_freshness_min: freshness,
      } as SaveAiConfigInput;
    }
    if (provider === "DISABLED") {
      return {
        provider: "DISABLED",
        model_id: "disabled",
        api_key: null,
        base_url: null,
        daily_token_cap: current?.dailyTokenCap ?? null,
        pii_redaction_enabled: true,
        insight_freshness_min: freshness,
      } as SaveAiConfigInput;
    }
    return {
      provider,
      model_id: current?.modelId ?? DEFAULT_MODEL[provider],
      api_key: "",
      base_url: null,
      daily_token_cap: current?.dailyTokenCap ?? null,
      pii_redaction_enabled: true,
      insight_freshness_min: freshness,
    } as SaveAiConfigInput;
  }, [current, initialProvider]);

  const form = useForm<SaveAiConfigInput>({
    defaultValues: initialValues,
    resolver: zodResolver(saveAiConfigSchema) as unknown as Resolver<
      SaveAiConfigInput
    >,
  });

  const provider = form.watch("provider") as AiProvider;

  function onProviderChange(next: AiProvider) {
    // Preserve the freshness window across provider swaps — it's a
    // "how AI insights behave" setting, not tied to any single vendor.
    const currentFreshness =
      (form.getValues("insight_freshness_min") as number | undefined) ?? 15;
    // Reset fields on provider swap so a stale base_url from
    // OPENAI_COMPATIBLE can't sneak into a GOOGLE payload.
    if (next === "OPENAI_COMPATIBLE") {
      form.reset({
        provider: "OPENAI_COMPATIBLE",
        model_id: DEFAULT_MODEL[next],
        api_key: null,
        base_url: "",
        daily_token_cap: null,
        pii_redaction_enabled: true,
        insight_freshness_min: currentFreshness,
      } as SaveAiConfigInput);
    } else if (next === "DISABLED") {
      form.reset({
        provider: "DISABLED",
        model_id: "disabled",
        api_key: null,
        base_url: null,
        daily_token_cap: null,
        pii_redaction_enabled: true,
        insight_freshness_min: currentFreshness,
      } as SaveAiConfigInput);
    } else {
      form.reset({
        provider: next,
        model_id: DEFAULT_MODEL[next],
        api_key: "",
        base_url: null,
        daily_token_cap: null,
        pii_redaction_enabled: true,
        insight_freshness_min: currentFreshness,
      } as SaveAiConfigInput);
    }
  }

  function onSubmit(values: SaveAiConfigInput) {
    startSave(async () => {
      const result = await saveAiConfigAction(values);
      if (result.ok) {
        toast.success(t("toast.savedOk"));
        // Wipe the API key on success so a subsequent update doesn't
        // re-send it in cleartext.
        form.resetField("api_key", {
          defaultValue:
            values.provider === "OPENAI_COMPATIBLE" ||
            values.provider === "DISABLED"
              ? null
              : "",
        });
      } else {
        toast.error(result.reason);
      }
    });
  }

  function onDeactivate() {
    if (!window.confirm(t("deactivateConfirm"))) return;
    startDeactivate(async () => {
      const result = await deactivateAiConfigAction({});
      if (result.ok) {
        toast.success(t("toast.deactivatedOk"));
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
          <Sparkles className="size-4 text-primary" aria-hidden />
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
                        onProviderChange(v as AiProvider);
                      }}
                      disabled={busy}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDER_OPTIONS.map((p) => (
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

            {provider !== "DISABLED" ? (
              <FormField
                control={form.control}
                name="model_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.modelId")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={tProviders(`${provider}.modelPlaceholder`)}
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription>
                      {tProviders(`${provider}.modelHint`)}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {provider === "OPENAI_COMPATIBLE" ? (
              <FormField
                control={form.control}
                name="base_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.baseUrl")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={tProviders(
                          "OPENAI_COMPATIBLE.baseUrlPlaceholder",
                        )}
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription>
                      {tProviders("OPENAI_COMPATIBLE.baseUrlHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {provider !== "DISABLED" ? (
              <FormField
                control={form.control}
                name="api_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.apiKey")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={tProviders(`${provider}.apiKeyPlaceholder`)}
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription>
                      {current?.hasApiKey
                        ? tProviders(`${provider}.apiKeyHintUpdate`)
                        : tProviders(`${provider}.apiKeyHint`)}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <FormField
              control={form.control}
              name="daily_token_cap"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.dailyCap")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === ""
                            ? null
                            : Number.parseInt(e.target.value, 10),
                        )
                      }
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>{t("fields.dailyCapHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="insight_freshness_min"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.freshnessMin")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={5}
                      max={1440}
                      step={5}
                      value={
                        typeof field.value === "number" && Number.isFinite(field.value)
                          ? field.value
                          : ""
                      }
                      onChange={(e) => {
                        // Empty input treated as "reset to default" (15).
                        // The Zod schema has `.default(15)` so this is
                        // safe on the wire too.
                        const raw = e.target.value;
                        field.onChange(
                          raw === "" ? 15 : Number.parseInt(raw, 10),
                        );
                      }}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormDescription>{t("fields.freshnessMinHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {provider === "OPENAI_COMPATIBLE" ? (
              <FormField
                control={form.control}
                name="pii_redaction_enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>{t("fields.piiRedaction")}</FormLabel>
                      <FormDescription>
                        {t("fields.piiRedactionHint")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value ?? true}
                        onChange={(e) => field.onChange(e.target.checked)}
                        disabled={busy}
                        className="size-4"
                        aria-label={t("fields.piiRedaction")}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            ) : null}

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
