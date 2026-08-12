import { z } from "zod";

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
} from "@/lib/notifications/categories";

/**
 * Zod schemas for the Preferences page (Phase 1 — notifications).
 *
 * Because `NOTIFICATION_CATEGORIES` and `NOTIFICATION_CHANNELS` come
 * from `Enums<...>` shape (see `categories.ts`), we can build the Zod
 * enums straight off those tuples — no drift between DB / TS / Zod.
 */

const categoryValues = NOTIFICATION_CATEGORIES as unknown as readonly [
  string,
  ...string[],
];
const channelValues = NOTIFICATION_CHANNELS as unknown as readonly [
  string,
  ...string[],
];

export const updatePreferencesSchema = z.object({
  // Array of { category, channel, enabled } — arbitrary length so the
  // client can send just the diffs. Empty array = no-op (still audited).
  toggles: z
    .array(
      z.object({
        category: z.enum(categoryValues),
        channel: z.enum(channelValues),
        enabled: z.boolean(),
      }),
    )
    .max(NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length, {
      message: "Too many toggles submitted.",
    }),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export const restoreDefaultsSchema = z
  .object({
    confirm: z.literal(true, {
      message: "Confirmation required to restore defaults.",
    }),
  })
  .strict();
export type RestoreDefaultsInput = z.infer<typeof restoreDefaultsSchema>;
