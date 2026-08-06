"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCommandPalette } from "@/components/shell/command-palette";

function subscribe() {
  // Platform never changes for the lifetime of the tab.
  return () => {};
}

function getIsMacSnapshot() {
  return navigator.platform.toLowerCase().includes("mac");
}

function getIsMacServerSnapshot() {
  return false;
}

export function CommandPaletteTrigger() {
  const { setOpen } = useCommandPalette();
  const t = useTranslations("common");
  const isMac = React.useSyncExternalStore(
    subscribe,
    getIsMacSnapshot,
    getIsMacServerSnapshot,
  );

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="hidden md:inline-flex gap-2 pr-1.5 text-muted-foreground"
    >
      <Search className="size-3.5" />
      <span className="text-xs">{t("search")}</span>
      <kbd className="ml-2 hidden select-none items-center gap-1 rounded border border-border/60 bg-muted/60 px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
        <span className="text-xs">{isMac ? "⌘" : "Ctrl"}</span>K
      </kbd>
    </Button>
  );
}
