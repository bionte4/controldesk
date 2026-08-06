/**
 * ControlDesk — AI Insights last-seen store (rules §15).
 *
 * Pure helper used by the topbar badge to compute unread count. Stores a
 * per-(tenant, user) timestamp in `localStorage` so the badge state is
 * private to the device and survives reloads.
 *
 * Kept as a plain module so it is unit-testable without a real browser.
 * Callers pass a `Storage`-like object (defaulting to `window.localStorage`
 * inside the component) so tests can inject a Map-backed fake.
 */

const KEY_PREFIX = "cd:ai-insights-lastseen";

export type LastSeenStorage = Pick<Storage, "getItem" | "setItem">;

export function lastSeenKey(input: {
  tenantId: string;
  userId: string;
}): string {
  return `${KEY_PREFIX}:${input.tenantId}:${input.userId}`;
}

/**
 * Read the last-seen ISO timestamp. Returns `null` when unset or malformed.
 * Malformed values are treated as unset so a bad write cannot lock the
 * badge permanently.
 */
export function readLastSeen(
  storage: LastSeenStorage | null,
  input: { tenantId: string; userId: string },
): string | null {
  if (!storage) return null;
  const raw = storage.getItem(lastSeenKey(input));
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

export function writeLastSeen(
  storage: LastSeenStorage | null,
  input: { tenantId: string; userId: string; iso: string },
): void {
  if (!storage) return;
  const parsed = Date.parse(input.iso);
  if (Number.isNaN(parsed)) return;
  storage.setItem(lastSeenKey(input), new Date(parsed).toISOString());
}

/**
 * Compute unread count from an array of insights. Insights whose
 * `created_at` is strictly greater than `lastSeenIso` count as unread.
 * `null` last-seen means "user never opened the page" — every insight
 * counts as unread.
 */
export function countUnread(
  insights: readonly { created_at: string }[],
  lastSeenIso: string | null,
): number {
  if (!lastSeenIso) return insights.length;
  const cutoff = Date.parse(lastSeenIso);
  if (Number.isNaN(cutoff)) return insights.length;
  let n = 0;
  for (const item of insights) {
    const t = Date.parse(item.created_at);
    if (!Number.isNaN(t) && t > cutoff) n += 1;
  }
  return n;
}
