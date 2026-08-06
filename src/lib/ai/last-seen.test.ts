import { describe, expect, it } from "vitest";

import {
  countUnread,
  lastSeenKey,
  readLastSeen,
  writeLastSeen,
  type LastSeenStorage,
} from "./last-seen";

function fakeStorage(): LastSeenStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

describe("lastSeenKey", () => {
  it("namespaces per tenant and user", () => {
    expect(lastSeenKey({ tenantId: TENANT, userId: USER })).toBe(
      `cd:ai-insights-lastseen:${TENANT}:${USER}`,
    );
  });
});

describe("readLastSeen / writeLastSeen", () => {
  it("roundtrips a valid ISO timestamp", () => {
    const s = fakeStorage();
    writeLastSeen(s, { tenantId: TENANT, userId: USER, iso: "2026-08-05T02:00:00Z" });
    expect(readLastSeen(s, { tenantId: TENANT, userId: USER })).toBe(
      "2026-08-05T02:00:00.000Z",
    );
  });

  it("returns null when unset", () => {
    const s = fakeStorage();
    expect(readLastSeen(s, { tenantId: TENANT, userId: USER })).toBeNull();
  });

  it("returns null when the stored value is not parseable", () => {
    const s = fakeStorage();
    s.data.set(lastSeenKey({ tenantId: TENANT, userId: USER }), "garbage");
    expect(readLastSeen(s, { tenantId: TENANT, userId: USER })).toBeNull();
  });

  it("ignores writes with a malformed iso", () => {
    const s = fakeStorage();
    writeLastSeen(s, {
      tenantId: TENANT,
      userId: USER,
      iso: "not-a-date",
    });
    expect(readLastSeen(s, { tenantId: TENANT, userId: USER })).toBeNull();
  });

  it("no-ops when storage is null (SSR)", () => {
    expect(readLastSeen(null, { tenantId: TENANT, userId: USER })).toBeNull();
    expect(() =>
      writeLastSeen(null, {
        tenantId: TENANT,
        userId: USER,
        iso: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});

describe("countUnread", () => {
  const insights = [
    { created_at: "2026-08-05T04:00:00Z" },
    { created_at: "2026-08-05T03:00:00Z" },
    { created_at: "2026-08-05T02:00:00Z" },
  ];

  it("counts everything when lastSeen is null", () => {
    expect(countUnread(insights, null)).toBe(3);
  });

  it("counts only strictly newer entries", () => {
    expect(countUnread(insights, "2026-08-05T03:00:00Z")).toBe(1);
  });

  it("returns 0 when lastSeen is at or after every insight", () => {
    expect(countUnread(insights, "2026-08-05T04:00:00Z")).toBe(0);
    expect(countUnread(insights, "2026-08-05T05:00:00Z")).toBe(0);
  });

  it("treats malformed lastSeen as unset", () => {
    expect(countUnread(insights, "not-a-date")).toBe(3);
  });

  it("returns 0 for an empty insights array", () => {
    expect(countUnread([], "2026-08-05T04:00:00Z")).toBe(0);
    expect(countUnread([], null)).toBe(0);
  });
});
