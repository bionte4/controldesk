"use client";

import * as React from "react";
import { NextIntlClientProvider, type Messages } from "next-intl";

import { ErrorListener } from "@/components/observability/error-listener";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({
  children,
  locale,
  messages,
  timeZone,
}: {
  children: React.ReactNode;
  locale: string;
  messages: Messages;
  timeZone: string;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
    >
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <ErrorListener />
        <TooltipProvider delay={200}>{children}</TooltipProvider>
        <Toaster richColors closeButton position="top-right" />
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
