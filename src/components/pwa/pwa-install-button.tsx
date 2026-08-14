"use client";

import * as React from "react";
import Link from "next/link";
import { Download, CheckCircle2, HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Slug of the "Install ControlDesk di HP" help article — kept as a
// constant so grepping for slug references stays easy if we ever
// rename the article. Do NOT inline it in JSX literals.
const INSTALL_HELP_SLUG = "install-mobile-app";

/**
 * Chrome-flavoured `beforeinstallprompt` event. Not typed in the
 * standard DOM library because it's a proposed spec (draft). We only
 * touch `prompt()` + `userChoice`, both of which every supporting
 * engine implements identically.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/**
 * Explicit "Install app" button — surfaces the browser's PWA install
 * prompt on demand, instead of relying on Chrome's opaque address-bar
 * icon that most users never notice.
 *
 * Behaviour matrix:
 *   ┌───────────────────────────────────────┬──────────────────────────┐
 *   │ State                                  │ What renders             │
 *   ├───────────────────────────────────────┼──────────────────────────┤
 *   │ Already installed (standalone display) │ Small "Terinstall" chip  │
 *   │ Installable (event fired, not yet     │ Full "Install ke HP"     │
 *   │ installed)                             │  button                  │
 *   │ Browser doesn't support install       │ Nothing (return null)    │
 *   │ (iOS Safari, in-app browsers, etc.)   │                          │
 *   └───────────────────────────────────────┴──────────────────────────┘
 *
 * `variant="compact"` renders a smaller pill for the sidebar footer;
 * `variant="hero"` renders a full-width primary button suitable for
 * onboarding banners.
 *
 * Why we don't auto-prompt on load:
 *   Chrome silently blocks calls to `prompt()` that aren't user-
 *   initiated. We MUST wait for a click. Auto-prompting also violates
 *   the PWA UX guidelines (spec) and gets flagged in Lighthouse.
 */
export function PwaInstallButton({
  variant = "compact",
  className,
}: {
  variant?: "compact" | "hero";
  className?: string;
}) {
  const [deferredPrompt, setDeferredPrompt] =
    React.useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);

  React.useEffect(() => {
    // 1. Detect if app is already running as installed PWA — hides
    //    the button. `display-mode: standalone` is the standard media
    //    query; Safari iOS also exposes `navigator.standalone`.
    const mq = window.matchMedia("(display-mode: standalone)");
    const check = () => {
      const iosStandalone = "standalone" in window.navigator &&
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsStandalone(mq.matches || iosStandalone);
    };
    check();
    mq.addEventListener("change", check);

    // 2. Capture the install prompt event when Chrome fires it. This
    //    ONLY fires when Chrome decides the site meets install
    //    criteria (manifest OK + SW registered + engagement heuristic).
    //    We stash the event so a later click can invoke `prompt()`.
    const handler = (e: Event) => {
      e.preventDefault(); // Suppress the default mini-infobar
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // 3. Reset state after successful install so button hides.
    const installedHandler = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      mq.removeEventListener("change", check);
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      // We don't care about the outcome for logging (Chrome hides
      // details for privacy), but we still await it so the state
      // resets cleanly on either accept or dismiss.
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    } finally {
      setInstalling(false);
    }
  }

  // Already installed: subtle "Terinstall" indicator (only in hero,
  // hidden in compact to avoid sidebar clutter).
  if (isStandalone) {
    if (variant === "hero") {
      return (
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400",
            className,
          )}
          role="status"
        >
          <CheckCircle2 className="size-3.5" aria-hidden />
          Aplikasi terinstall
        </div>
      );
    }
    return null;
  }

  // Not installable — this browser either doesn't support PWA install
  // (iOS Safari, in-app webviews) or Chrome hasn't decided to allow it
  // yet (engagement heuristic in progress). Historically we rendered
  // `null` here, which meant iOS users had NO cue that they can still
  // install via Safari's Share → "Add to Home Screen". Now we render
  // a subtle help link to the install-mobile-app article, which
  // documents the per-platform paths (Chrome / Safari iOS / desktop /
  // TWA APK). The link is styled understated so it doesn't nag Chrome
  // users who'll get the native prompt within the same session.
  if (!deferredPrompt) {
    if (variant === "hero") {
      return (
        <Link
          href={`/help/${INSTALL_HELP_SLUG}`}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
            className,
          )}
        >
          <HelpCircle className="size-3.5" aria-hidden />
          Cara install ControlDesk di HP
        </Link>
      );
    }
    // Compact (sidebar footer). Even smaller — icon-only anchor with
    // aria-label so screen readers still announce it. Hidden on
    // very small screens where the sidebar itself is drawer-only.
    return (
      <Link
        href={`/help/${INSTALL_HELP_SLUG}`}
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80 hover:text-foreground",
          className,
        )}
        aria-label="Cara install ControlDesk sebagai aplikasi"
      >
        <HelpCircle className="size-3" aria-hidden />
        Cara install di HP?
      </Link>
    );
  }

  if (variant === "hero") {
    return (
      <div className={cn("flex flex-col items-start gap-2", className)}>
        <Button
          onClick={handleInstall}
          disabled={installing}
          size="lg"
          className="gap-2"
        >
          <Download className="size-4" aria-hidden />
          {installing ? "Membuka prompt install…" : "Install aplikasi ke HP"}
        </Button>
        <Link
          href={`/help/${INSTALL_HELP_SLUG}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Butuh bantuan? Baca panduan install
        </Link>
      </div>
    );
  }

  // Compact: pill button for sidebar footer.
  return (
    <Button
      onClick={handleInstall}
      disabled={installing}
      variant="outline"
      size="sm"
      className={cn(
        "w-full justify-start gap-2 border-indigo-500/30 bg-indigo-500/10 text-xs font-medium text-indigo-600 hover:bg-indigo-500/20 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200",
        className,
      )}
      aria-label="Install ControlDesk sebagai aplikasi"
    >
      <Download className="size-3.5" aria-hidden />
      Install ke HP
    </Button>
  );
}
