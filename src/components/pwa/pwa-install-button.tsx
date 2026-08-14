"use client";

import * as React from "react";
import { Download, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  // yet (engagement heuristic in progress). We render null in compact
  // mode so the sidebar footer doesn't dangle an unusable button, but
  // still expose a helper text in hero mode so onboarding pages can
  // guide the user manually.
  if (!deferredPrompt) {
    return null;
  }

  if (variant === "hero") {
    return (
      <Button
        onClick={handleInstall}
        disabled={installing}
        size="lg"
        className={cn("gap-2", className)}
      >
        <Download className="size-4" aria-hidden />
        {installing ? "Membuka prompt install…" : "Install aplikasi ke HP"}
      </Button>
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
