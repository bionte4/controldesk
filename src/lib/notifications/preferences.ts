import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from "./categories";

/**
 * Preferences data access layer.
 *
 * The DB stores explicit rows for every toggled preference — an
 * absent row is treated as *implicit ALLOW* (fail-open). This keeps
 * behaviour identical to pre-migration for users who never open
 * Preferences.
 */

export type PreferencesGrid = Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
>;

/**
 * Build a fresh "all ON" grid, used as the default state and as the
 * baseline for merging DB rows on top.
 */
export function defaultPreferencesGrid(): PreferencesGrid {
  const out = {} as PreferencesGrid;
  for (const cat of NOTIFICATION_CATEGORIES) {
    out[cat] = {} as Record<NotificationChannel, boolean>;
    for (const ch of NOTIFICATION_CHANNELS) {
      out[cat][ch] = true;
    }
  }
  return out;
}

/**
 * Load the current user's preferences as a fully populated grid.
 * Missing rows default to ON so callers never see `undefined`.
 * Wrapped in `cache()` for per-request dedup.
 */
export const loadPreferencesForUser = cache(
  async (input: {
    tenantId: string;
    userId: string;
  }): Promise<PreferencesGrid> => {
    const supabase = await createClient();
    const grid = defaultPreferencesGrid();

    const { data, error } = await supabase
      .from("user_notification_preferences")
      .select("category, channel, enabled")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.userId);
    if (error || !data) return grid;

    for (const row of data) {
      const cat = row.category as NotificationCategory;
      const ch = row.channel as NotificationChannel;
      if (grid[cat] && ch in grid[cat]) {
        grid[cat][ch] = row.enabled;
      }
    }
    return grid;
  },
);

/**
 * Query a specific (category, channel) toggle. Used by the dispatcher
 * on the hot path — one round-trip per notification is acceptable at
 * this scale (rules §20 rate is O(dozens/tenant/day) not O(seconds)).
 */
export async function isChannelEnabled(input: {
  tenantId: string;
  userId: string;
  category: NotificationCategory;
  channel: NotificationChannel;
}): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_notification_preferences")
    .select("enabled")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .eq("category", input.category)
    .eq("channel", input.channel)
    .maybeSingle();
  if (!data) return true; // fail-open
  return (data as { enabled: boolean }).enabled;
}

/**
 * Batched variant of `isChannelEnabled` — resolves an array of
 * (category, channel) pairs in one query. Cheaper than N round-trips
 * when we broadcast to a role.
 */
export async function loadEnabledMap(input: {
  tenantId: string;
  userId: string;
}): Promise<
  Map<`${NotificationCategory}:${NotificationChannel}`, boolean>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_notification_preferences")
    .select("category, channel, enabled")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId);
  const out = new Map<`${NotificationCategory}:${NotificationChannel}`, boolean>();
  for (const row of data ?? []) {
    out.set(
      `${row.category as NotificationCategory}:${row.channel as NotificationChannel}`,
      row.enabled,
    );
  }
  return out;
}

/**
 * Persist a single toggle (upsert-by-key). The RLS policy already
 * scopes writes to `auth.uid()`, so we don't re-check ownership here.
 */
export async function upsertPreference(input: {
  tenantId: string;
  userId: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("user_notification_preferences").upsert(
    {
      tenant_id: input.tenantId,
      user_id: input.userId,
      category: input.category,
      channel: input.channel,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,user_id,category,channel" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Bulk upsert — used by "Save changes" so the whole grid lands in a
 * single DB round-trip.
 */
export async function upsertPreferencesGrid(input: {
  tenantId: string;
  userId: string;
  grid: PreferencesGrid;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const rows: {
    tenant_id: string;
    user_id: string;
    category: NotificationCategory;
    channel: NotificationChannel;
    enabled: boolean;
    updated_at: string;
  }[] = [];
  const now = new Date().toISOString();
  for (const cat of NOTIFICATION_CATEGORIES) {
    for (const ch of NOTIFICATION_CHANNELS) {
      rows.push({
        tenant_id: input.tenantId,
        user_id: input.userId,
        category: cat,
        channel: ch,
        enabled: input.grid[cat][ch],
        updated_at: now,
      });
    }
  }
  const { error } = await supabase
    .from("user_notification_preferences")
    .upsert(rows, { onConflict: "tenant_id,user_id,category,channel" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Restore to "all ON" default by wiping user's rows. The dispatcher
 * treats absence as ALLOW, so DELETE gives clean-slate behaviour and
 * avoids stale rows lingering when we add categories later.
 */
export async function resetPreferencesForUser(input: {
  tenantId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_notification_preferences")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
