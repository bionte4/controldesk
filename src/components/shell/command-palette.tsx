"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Home,
  ClipboardList,
  Briefcase,
  ReceiptText,
  Wallet,
  Coins,
  ShieldCheck,
  Users,
  FileClock,
  Banknote,
  LineChart,
  BrainCircuit,
  BookText,
  Moon,
  Sun,
  LogOut,
  Languages,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { signOut } from "@/app/(auth)/actions";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/config";
import { setLocaleAction } from "@/lib/i18n/actions";
import type { NavItemKey } from "@/lib/nav/config";

type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CommandPaletteContext =
  React.createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette() {
  const ctx = React.useContext(CommandPaletteContext);
  if (!ctx)
    throw new Error("useCommandPalette must be used within CommandPalette");
  return ctx;
}

type NavCommand = {
  titleKey: NavItemKey;
  href: string;
  icon: LucideIcon;
};

const NAV_COMMANDS: NavCommand[] = [
  { titleKey: "dashboard", href: "/dashboard", icon: Home },
  { titleKey: "projects", href: "/projects", icon: ClipboardList },
  { titleKey: "clients", href: "/clients", icon: Briefcase },
  { titleKey: "team", href: "/team", icon: Users },
  { titleKey: "expenses", href: "/finance/expenses", icon: ReceiptText },
  { titleKey: "cashAdvance", href: "/finance/cash-advance", icon: Wallet },
  { titleKey: "pettyCash", href: "/finance/petty-cash", icon: Coins },
  { titleKey: "approvals", href: "/approvals", icon: ShieldCheck },
  { titleKey: "roster", href: "/hr/roster", icon: FileClock },
  { titleKey: "leaveOvertime", href: "/hr/requests", icon: FileClock },
  { titleKey: "payroll", href: "/hr/payroll", icon: Banknote },
  { titleKey: "reports", href: "/reports", icon: LineChart },
  { titleKey: "insights", href: "/insights", icon: BrainCircuit },
];

/**
 * A single tenant Knowledge Base entry surfaced in the Cmd+K palette
 * (Fase 2b). Kept structural — the layout RSC fills this array from
 * `loadTenantSearchIndex()` and passes it here through the RSC ↔
 * Client boundary. `cmdk`'s built-in fuzzy filter runs against the
 * `value` we set on each `CommandItem` (title + summary), so no
 * separate fuse.js instance is needed inside the palette.
 */
export type KnowledgePaletteEntry = {
  slug: string;
  title: string;
  summary: string;
};

export function CommandPalette({
  children,
  knowledgeArticles = [],
}: {
  children: React.ReactNode;
  /**
   * Recent published tenant articles to surface as jumpable entries.
   * Passed from the app layout RSC. Empty array = feature disabled
   * (also true when the tenant has no published KB yet); the "Knowledge
   * Base" group is omitted entirely in that case so power users don't
   * see a dead heading.
   */
  knowledgeArticles?: readonly KnowledgePaletteEntry[];
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  const tNav = useTranslations("nav");
  const tItems = useTranslations("nav.items");
  const tTheme = useTranslations("nav.theme");
  const tCommon = useTranslations("common");
  const [, startTransition] = React.useTransition();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  function switchLocale(next: Locale) {
    setOpen(false);
    startTransition(async () => {
      await setLocaleAction(next);
    });
  }

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={tNav("commandPlaceholder")} />
        <CommandList>
          <CommandEmpty>{tCommon("noResults")}</CommandEmpty>

          <CommandGroup heading={tNav("sections.navigation")}>
            {NAV_COMMANDS.map((cmd) => {
              const label = tItems(cmd.titleKey);
              return (
                <CommandItem
                  key={cmd.href}
                  value={label}
                  onSelect={() => navigate(cmd.href)}
                >
                  <cmd.icon />
                  <span>{label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>

          {knowledgeArticles.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={tNav("sections.knowledge")}>
                {knowledgeArticles.map((entry) => (
                  <CommandItem
                    key={entry.slug}
                    // `cmdk` filters by `value`; include the summary so
                    // typing a phrase from the article body still
                    // surfaces the entry. Prefixing with `kb ` gives
                    // power users a way to scope the palette to KB by
                    // typing "kb <query>".
                    value={`kb ${entry.title} ${entry.summary}`}
                    onSelect={() => navigate(`/knowledge/${entry.slug}`)}
                  >
                    <BookText />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{entry.title}</span>
                      {entry.summary ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.summary}
                        </span>
                      ) : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}

          <CommandSeparator />

          <CommandGroup heading={tNav("sections.appearance")}>
            <CommandItem onSelect={() => setTheme("light")}>
              <Sun /> {tTheme("light")}
            </CommandItem>
            <CommandItem onSelect={() => setTheme("dark")}>
              <Moon /> {tTheme("dark")}
            </CommandItem>
            <CommandItem onSelect={() => setTheme("system")}>
              <Sun /> {tTheme("system")}
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={tNav("sections.language")}>
            {LOCALES.map((code) => (
              <CommandItem
                key={code}
                value={LOCALE_LABELS[code]}
                onSelect={() => switchLocale(code)}
              >
                <Languages /> {LOCALE_LABELS[code]}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={tNav("sections.session")}>
            <CommandItem
              onSelect={() => {
                setOpen(false);
                void signOut();
              }}
            >
              <LogOut /> {tCommon("signOut")}
              <CommandShortcut>⌘⇧Q</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
