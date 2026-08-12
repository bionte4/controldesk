"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Languages, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT,
  isLocale,
  type Locale,
} from "@/lib/i18n/config";
import { setLocaleAction } from "@/lib/i18n/actions";

type Variant = "default" | "compact";

export function LanguageToggle({ variant = "default" }: { variant?: Variant } = {}) {
  const current = useLocale();
  const t = useTranslations("nav.language");
  const [isPending, startTransition] = React.useTransition();

  function handleSelect(next: Locale) {
    if (next === current) return;
    startTransition(async () => {
      await setLocaleAction(next);
    });
  }

  const activeLocale: Locale = isLocale(current) ? current : "id";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant === "compact" ? "ghost" : "outline"}
            size={variant === "compact" ? "icon" : "sm"}
            aria-label={t("label")}
            className={variant === "compact" ? "size-8" : "gap-1.5"}
            disabled={isPending}
          />
        }
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Languages className="size-4" />
        )}
        {variant === "default" ? (
          <span className="text-xs font-medium">
            {LOCALE_SHORT[activeLocale]}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {t("label")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOCALES.map((code) => {
          const isActive = code === activeLocale;
          return (
            <DropdownMenuItem
              key={code}
              onClick={() => handleSelect(code)}
              disabled={isPending}
              className="justify-between"
            >
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                  {LOCALE_SHORT[code]}
                </span>
                <span>{LOCALE_LABELS[code]}</span>
              </span>
              {isActive ? (
                <Check className="size-3.5 text-primary" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
