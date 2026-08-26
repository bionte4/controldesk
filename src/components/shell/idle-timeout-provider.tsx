"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { signOutWithReason } from "@/app/(auth)/actions";
import { portalLogoutAction } from "@/app/(portal)/actions";

/**
 * IdleTimeoutProvider — wires `useIdleTimeout` into the shell layout and
 * renders the warning modal / handles final sign-out.
 *
 * Two variants:
 *   - `app`    : app-side tenant users (Supabase Auth). Logs out via
 *                `signOut()` server action → `/login?reason=idle_timeout`.
 *   - `portal` : external client-portal users (custom `client_user_sessions`
 *                table). Logs out via `portalLogoutAction()` server action →
 *                `/portal/login?reason=idle_timeout`.
 *
 * The parent server component MUST read `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES`
 * and `NEXT_PUBLIC_IDLE_WARNING_MINUTES` and pass them as props here, so
 * this component stays purely presentational.
 *
 * Auto-logout at end of countdown is guaranteed even if the user closes
 * the tab or lets the modal sit — the underlying `setTimeout` fires
 * independently of the modal UI.
 */
type IdleTimeoutProviderProps = {
  children: React.ReactNode;
  variant: "app" | "portal";
  timeoutMinutes: number;
  warningMinutes: number;
  absoluteMinutes?: number;
  sessionStartedAt?: number;
};

export function IdleTimeoutProvider({
  children,
  variant,
  timeoutMinutes,
  warningMinutes,
  absoluteMinutes = 480,
  sessionStartedAt,
}: IdleTimeoutProviderProps) {
  const t = useTranslations("session");
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const warningMs = warningMinutes * 60 * 1000;

  const [warnOpen, setWarnOpen] = useState(false);
  const [countdownSec, setCountdownSec] = useState(
    Math.ceil(warningMs / 1000),
  );
  // isPending covers the "logout in flight" window (button click → navigation)
  // which is all we need for the JSX-side `disabled` prop. loggingOutRef stays
  // as a separate latch inside event-loop callbacks below so we never double-
  // fire signOut after the transition kicks off, even before React commits the
  // pending state.
  const [isLoggingOut, startLogoutTransition] = useTransition();

  const loggingOutRef = useRef(false);
  const lastHeartbeatRef = useRef(0);

  const sendActivityHeartbeat = useCallback(() => {
    const now = Date.now();
    if (now - lastHeartbeatRef.current < 30_000) return;
    lastHeartbeatRef.current = now;
    const endpoint = variant === "portal"
      ? "/portal/api/session/activity"
      : "/api/session/activity";
    void fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-session-activity": "human" },
      cache: "no-store",
    });
  }, [variant]);

  const performLogout = useCallback((reason: "idle_timeout" | "absolute_timeout") => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setWarnOpen(false);
    startLogoutTransition(async () => {
      try {
        if (variant === "portal") {
          await portalLogoutAction(reason);
        } else {
          await signOutWithReason(reason);
        }
      } catch {
        // Server actions throw internally on `redirect()` — that's expected.
        // Fall through to hard reload as safety net (below).
      }
      const loginUrl =
        variant === "portal"
          ? `/portal/login?reason=${reason}`
          : `/login?reason=${reason}`;
      window.location.assign(loginUrl);
    });
  }, [variant]);
  const handleTimeout = useCallback(() => performLogout("idle_timeout"), [performLogout]);
  const handleAbsoluteTimeout = useCallback(() => performLogout("absolute_timeout"), [performLogout]);

  const handleWarn = useCallback(() => {
    if (loggingOutRef.current) return;
    setCountdownSec(Math.ceil(warningMs / 1000));
    setWarnOpen(true);
  }, [warningMs]);

  const handleActivity = useCallback(() => {
    if (loggingOutRef.current) return;
    if (warnOpen) setWarnOpen(false);
    sendActivityHeartbeat();
  }, [warnOpen, sendActivityHeartbeat]);

  const { extend } = useIdleTimeout({
    timeoutMs,
    warningMs,
    onWarn: handleWarn,
    onTimeout: handleTimeout,
    onActivity: handleActivity,
    enabled: true,
  });

  // Establish the signed server-side timestamps immediately. The endpoint
  // never treats polling as activity; only this human-event-driven provider
  // invokes it.
  useEffect(() => sendActivityHeartbeat(), [sendActivityHeartbeat]);

  // Absolute lifetime is non-sliding. Server proxy is authoritative; this
  // client timer provides immediate UX even when no navigation occurs.
  useEffect(() => {
    const started = sessionStartedAt ?? Date.now();
    const remaining = started + absoluteMinutes * 60_000 - Date.now();
    if (remaining <= 0) {
      handleAbsoluteTimeout();
      return;
    }
    const id = window.setTimeout(handleAbsoluteTimeout, remaining);
    return () => window.clearTimeout(id);
  }, [absoluteMinutes, handleAbsoluteTimeout, sessionStartedAt]);

  // Countdown tick while modal is open. Independent of the underlying
  // timeout — this is display only. Actual logout is guaranteed by
  // `handleTimeout` firing from the hook's setTimeout regardless.
  useEffect(() => {
    if (!warnOpen) return;
    const id = setInterval(() => {
      setCountdownSec((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [warnOpen]);

  const handleExtend = () => {
    extend();
    setWarnOpen(false);
  };

  return (
    <>
      {children}
      <Dialog
        open={warnOpen}
        onOpenChange={(open) => {
          if (!open) handleExtend();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span
                className="inline-flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                aria-hidden="true"
              >
                <Clock className="size-5" />
              </span>
              <div className="flex-1">
                <DialogTitle className="text-base">{t("warnTitle")}</DialogTitle>
              </div>
            </div>
            <DialogDescription className="pt-2">
              {t("warnBody", { seconds: countdownSec })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={handleTimeout}
              disabled={isLoggingOut}
            >
              {t("logoutNow")}
            </Button>
            <Button type="button" onClick={handleExtend}>
              {t("extend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
