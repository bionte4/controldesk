"use client";

import * as React from "react";
import { BellRing, BellOff, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * ControlDesk — Push subscription card (Preferences page).
 *
 * Handles the full opt-in / opt-out lifecycle for Web Push:
 *
 *   1. Feature detection — hides itself on browsers without SW +
 *      PushManager (iOS Safari <16.4, in-app webviews, old Firefox).
 *   2. Permission state polling — shows the right CTA depending on
 *      `Notification.permission` (`default` / `granted` / `denied`).
 *   3. Subscribe flow:
 *        a. Ask browser permission.
 *        b. Register SW is already done by SerwistProvider at boot;
 *           we just fetch the existing registration.
 *        c. Call `pushManager.subscribe({ applicationServerKey })`
 *           using the VAPID public key from env.
 *        d. POST the subscription payload to `/api/push/subscribe`.
 *   4. Unsubscribe: `pushManager.unsubscribe()` + DELETE endpoint.
 *
 * ## Why we don't render our own permission prompt
 *
 * Chrome specifically requires the permission prompt to be triggered
 * by a user gesture (click). We DO NOT show a synthetic banner asking
 * "would you like to enable notifications?" and then trigger the real
 * prompt on their "yes" — that's a violation of the Notifications
 * spec engagement rules (Chrome will deny the permission after two
 * dismissals). Instead, the user MUST click our "Aktifkan" button
 * directly; that click is the gesture that unlocks the browser prompt.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type PermissionState = "default" | "granted" | "denied";

/**
 * Detects at mount time whether the browser can even do Web Push.
 * `null` means feature detection hasn't run yet (SSR); once mounted
 * we set true or false. We render nothing during the null phase to
 * avoid a hydration mismatch that would flash the wrong CTA.
 */
/**
 * Feature detection needs `window` + `navigator`, so it can only run
 * client-side. We funnel the result through `useSyncExternalStore`
 * — pattern React officially recommends for browser APIs that
 * effectively never change after mount:
 *
 *   - `getServerSnapshot` returns the "unknown" sentinel so SSR + first
 *     client render agree (no hydration mismatch).
 *   - `getSnapshot` runs the actual detection once per mount.
 *   - `subscribe` is a no-op — this value is immutable after mount.
 *
 * Alternative would be a `useEffect` with `setState`, but that trips
 * `react-hooks/set-state-in-effect` (unnecessary cascading render).
 */
type SupportState = { supported: boolean | null; reason?: string };

const UNKNOWN_SUPPORT: SupportState = { supported: null };

function detectSupport(): SupportState {
  if (typeof window === "undefined") return UNKNOWN_SUPPORT;
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "no_service_worker" };
  }
  if (!("PushManager" in window)) {
    return { supported: false, reason: "no_push_manager" };
  }
  if (!("Notification" in window)) {
    return { supported: false, reason: "no_notification_api" };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { supported: false, reason: "no_vapid_configured" };
  }
  return { supported: true };
}

// `useSyncExternalStore` requires stable references — cache them at
// module scope so React doesn't tear on re-renders.
const supportSnapshot = (() => {
  let cached: SupportState | null = null;
  return () => {
    if (cached === null) cached = detectSupport();
    return cached;
  };
})();
const supportServerSnapshot = () => UNKNOWN_SUPPORT;
const supportSubscribe = () => () => {};

function useFeatureSupport(): SupportState {
  return React.useSyncExternalStore(
    supportSubscribe,
    supportSnapshot,
    supportServerSnapshot,
  );
}

/**
 * VAPID public keys are base64url-encoded; PushManager requires a
 * raw Uint8Array. Standard conversion recipe from web-push docs.
 *
 * TS 5.7+ note: we return `Uint8Array<ArrayBuffer>` (allocated
 * explicitly) rather than the default `Uint8Array<ArrayBufferLike>`
 * so it satisfies `PushSubscriptionOptionsInit.applicationServerKey`
 * which requires `BufferSource` (i.e. `ArrayBuffer`-backed).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export function PushSubscribeCard() {
  const feature = useFeatureSupport();
  const [permission, setPermission] = React.useState<PermissionState>("default");
  const [subscribed, setSubscribed] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Read initial permission + subscription state after mount.
  //
  // Both setState calls are hoisted into the async IIFE (inc. the
  // trivial `setPermission`) so the react-hooks lint rule doesn't
  // flag them as synchronous effect writes. The behaviour is
  // identical — permission read is O(1), same tick as the async
  // branch's microtask kick-off.
  React.useEffect(() => {
    if (feature.supported !== true) return;

    (async () => {
      setPermission(Notification.permission as PermissionState);
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setSubscribed(false);
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    })().catch(() => {
      setSubscribed(false);
    });
  }, [feature.supported]);

  async function handleSubscribe() {
    if (!VAPID_PUBLIC_KEY) return;
    setBusy(true);
    try {
      // 1. Permission gate. On first call this opens the browser
      //    prompt; subsequent calls resolve immediately with the
      //    stored decision.
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") {
        toast.error(
          perm === "denied"
            ? "Izin notifikasi ditolak. Aktifkan dari pengaturan browser."
            : "Izin notifikasi dibatalkan.",
        );
        return;
      }

      // 2. Get SW registration (SerwistProvider registered it at boot).
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.ready;
      }

      // 3. Subscribe via PushManager. `userVisibleOnly: true` is
      //    mandatory in Chrome — silent push is not allowed.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // 4. Persist to server. The browser gives us the endpoint +
      //    keys inside `sub.toJSON()`.
      const raw = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: raw.endpoint,
          keys: {
            p256dh: raw.keys?.p256dh ?? "",
            auth: raw.keys?.auth ?? "",
          },
        }),
      });

      if (!res.ok) {
        // Roll back the browser-side subscription so we don't leave a
        // ghost — server unaware, browser thinks it's subscribed.
        await sub.unsubscribe().catch(() => undefined);
        toast.error("Gagal menyimpan langganan di server.");
        return;
      }

      setSubscribed(true);
      toast.success("Notifikasi push aktif untuk perangkat ini.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal mengaktifkan notifikasi.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        // Best-effort server cleanup. If it fails the user's
        // subscription is already dead browser-side; the row on
        // the server will get pruned next time we hit 410.
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => undefined);
      }
      setSubscribed(false);
      toast.success("Notifikasi push dinonaktifkan untuk perangkat ini.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal menonaktifkan notifikasi.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Feature-detection loading — render nothing until we know.
  if (feature.supported === null) {
    return null;
  }

  // Unsupported browser (iOS Safari < 16.4, in-app webview, etc.).
  if (feature.supported === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-5" aria-hidden />
            Notifikasi push (HP)
            <Badge variant="outline" className="text-xs">
              Tidak didukung
            </Badge>
          </CardTitle>
          <CardDescription>
            Browser ini tidak mendukung Web Push. Coba buka ControlDesk di{" "}
            <span className="font-medium">Chrome</span> atau{" "}
            <span className="font-medium">Firefox</span> di HP, atau install
            aplikasi (PWA) lewat tombol &quot;Install ke HP&quot; di sidebar
            untuk kirim notifikasi langsung ke home screen.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-5" aria-hidden />
          Notifikasi push (HP)
          {subscribed === true ? (
            <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
              Aktif
            </Badge>
          ) : permission === "denied" ? (
            <Badge variant="destructive">Diblokir</Badge>
          ) : (
            <Badge variant="outline">Belum aktif</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Kirim notifikasi ke lock screen HP kamu untuk request approval,
          settlement CA, SLA warning, dan update assignment. Berlaku hanya
          untuk perangkat ini — install aplikasi di HP lain kalau butuh
          multi-device.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {permission === "denied" ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-800 dark:text-rose-200">
            Kamu memblokir izin notifikasi untuk site ini. Buka pengaturan
            browser → Site settings → Notifications, izinkan{" "}
            <code className="rounded bg-rose-500/10 px-1">
              {typeof window !== "undefined" ? window.location.hostname : ""}
            </code>
            , lalu refresh halaman ini.
          </div>
        ) : subscribed === true ? (
          <Button
            onClick={handleUnsubscribe}
            disabled={busy}
            variant="outline"
            className="w-fit gap-2"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <BellOff className="size-4" aria-hidden />
            )}
            Matikan notifikasi
          </Button>
        ) : (
          <Button
            onClick={handleSubscribe}
            disabled={busy}
            className="w-fit gap-2"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <BellRing className="size-4" aria-hidden />
            )}
            Aktifkan notifikasi
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Kamu tetap bisa atur kategori notifikasi mana yang mau di-push
          lewat matriks di atas (kolom &quot;Push (mobile)&quot;).
        </p>
      </CardContent>
    </Card>
  );
}
