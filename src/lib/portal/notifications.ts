/**
 * ControlDesk — Client Portal notifications data helpers (GAS §28, rules §20, §28).
 *
 * SECURITY CONTRACT — same rules as `src/lib/portal/data.ts`:
 *   1. Every function accepts a `PortalSession` argument (no cookie re-reads).
 *   2. Every query is scoped by `tenant_id` AND `client_user_id`; portal
 *      users lack a JWT so this app-layer filter is the ONLY isolation.
 *   3. Uses `createServiceRoleClient()` because portal users have no
 *      `authenticated` role.
 */

import { cache } from "react";

import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

import type { PortalSession } from "./session";

export type PortalNotificationRow = Pick<
  Tables<"portal_notifications">,
  | "id"
  | "tenant_id"
  | "client_user_id"
  | "kind"
  | "title"
  | "body"
  | "action_url"
  | "payload"
  | "read_at"
  | "created_at"
>;

const NOTIFICATION_COLS =
  "id, tenant_id, client_user_id, kind, title, body, action_url, payload, read_at, created_at" as const;

/**
 * List notifications for the current portal user. Newest first. Capped at
 * 100 rows — the portal UI paginates via "load more" (not implemented yet;
 * default cap is intentional to avoid unbounded reads).
 */
export const listPortalNotifications = cache(
  async (
    session: PortalSession,
    opts?: { unreadOnly?: boolean; limit?: number },
  ): Promise<PortalNotificationRow[]> => {
    const supabase = createServiceRoleClient();
    let q = supabase
      .from("portal_notifications")
      .select(NOTIFICATION_COLS)
      .eq("tenant_id", session.client.tenant_id)
      .eq("client_user_id", session.client_user.id)
      .order("created_at", { ascending: false })
      .limit(opts?.limit ?? 100);

    if (opts?.unreadOnly) q = q.is("read_at", null);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as PortalNotificationRow[];
  },
);

/**
 * Unread count for the topbar bell badge. Kept in its own helper (with
 * `head: true` + `count: "exact"`) so the payload is a single integer.
 */
export const getPortalUnreadCount = cache(
  async (session: PortalSession): Promise<number> => {
    const supabase = createServiceRoleClient();
    const { count, error } = await supabase
      .from("portal_notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.client.tenant_id)
      .eq("client_user_id", session.client_user.id)
      .is("read_at", null);
    if (error) throw error;
    return count ?? 0;
  },
);
