import "server-only";

import webpush from "web-push";

import { log } from "@/lib/observability/log";
import type { NotificationKind } from "@/types/database";

import { isChannelEnabled } from "@/lib/notifications/preferences";
import { categoryForKind } from "@/lib/notifications/categories";

import {
  listActiveSubscriptionsForUser,
  markSubscriptionDisabled,
  touchSubscription,
} from "./repository";

/**
 * ControlDesk — Web Push dispatcher (Day 2 of the Android APK plan).
 *
 * Mirrors the fire-and-forget shape of `dispatchNotificationEmail` /
 * `dispatchTelegram` / `dispatchWhatsApp` in `notifications/service.ts`:
 *
 *   - Called via `void dispatchWebPush(...).catch(...)` after the
 *     in-app row has been enqueued. NEVER awaited by the caller.
 *   - Preference gate FIRST (`isChannelEnabled({ channel: "PUSH" })`)
 *     so users can silence a category without unsubscribing all
 *     devices.
 *   - Every failure logs a warning; nothing propagates.
 *
 * VAPID config:
 *   Read from env once at module load. If any of the three vars is
 *   missing we mark the module `disabled` — dispatch becomes a no-op
 *   instead of crashing on every notification. This mirrors how
 *   telegram/whatsapp dispatchers gracefully degrade when a tenant
 *   hasn't configured them.
 */

const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

const vapidReady = Boolean(VAPID_SUBJECT && VAPID_PUBLIC && VAPID_PRIVATE);

if (vapidReady) {
  webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC!, VAPID_PRIVATE!);
} else {
  log.warn("web_push_disabled_missing_vapid", {
    has_subject: Boolean(VAPID_SUBJECT),
    has_public: Boolean(VAPID_PUBLIC),
    has_private: Boolean(VAPID_PRIVATE),
  });
}

/**
 * Push payload contract — MUST match what `src/sw.ts::push` handler
 * expects. If you rename a field here, update the SW at the same time
 * or notifications silently render with default values.
 */
export type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
};

/**
 * Fire-and-forget Web Push. Loads all active subscriptions for the
 * recipient, sends to each in parallel, disables the ones the push
 * service reports as dead (404/410).
 *
 * Returns `void` intentionally — the caller (`notifyUser`) does not
 * care about outcome; the in-app row is source of truth (rules §20).
 */
export async function dispatchWebPush(input: {
  tenantId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  actionUrl?: string;
}): Promise<void> {
  if (!vapidReady) return;

  // Preference gate — same shape as email/telegram/whatsapp so users
  // get one consistent switchboard in Settings > Preferences.
  const category = categoryForKind(input.kind);
  const allowed = await isChannelEnabled({
    tenantId: input.tenantId,
    userId: input.userId,
    category,
    channel: "PUSH",
  });
  if (!allowed) return;

  const subs = await listActiveSubscriptionsForUser({
    tenantId: input.tenantId,
    userId: input.userId,
  });
  if (subs.length === 0) return;

  const payload: PushPayload = {
    title: input.title,
    body: input.body,
    url: input.actionUrl,
    // Tag by kind so a burst of the same kind (e.g. 5 expenses queued
    // at once) collapses into a single banner instead of stacking.
    tag: input.kind,
  };
  const payloadJson = JSON.stringify(payload);

  // Fan out in parallel; each device is independent so a slow FCM
  // response for one device must never delay another.
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payloadJson,
          {
            // 24 h — if the device is offline longer than this, drop
            // it. Push service will hold notifications up to TTL and
            // deliver on the next reconnect (or discard silently).
            TTL: 24 * 60 * 60,
            urgency: "normal",
          },
        );
        void touchSubscription({ subscriptionId: sub.id });
      } catch (err) {
        // web-push exposes statusCode on its errors. 404 = endpoint
        // gone (unsubscribed), 410 = gone forever. Anything else is
        // transient (network hiccup, push service brownout) — we log
        // but leave the row alone so it retries next time.
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: unknown }).statusCode)
            : 0;
        const message = err instanceof Error ? err.message : String(err);

        if (statusCode === 404 || statusCode === 410) {
          void markSubscriptionDisabled({
            subscriptionId: sub.id,
            reason: `push_service_${statusCode}`,
          });
          log.info("web_push_subscription_pruned", {
            subscription_id: sub.id,
            status: statusCode,
          });
        } else {
          log.warn("web_push_send_failed", {
            subscription_id: sub.id,
            status: statusCode,
            err: message,
          });
        }
      }
    }),
  );
}
