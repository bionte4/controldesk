import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Push dispatcher tests. Focus on the parts most likely to regress:
 *
 *   1. Fail-open when VAPID env vars are missing (no crash).
 *   2. Preference gate short-circuits (never touches the push service).
 *   3. Empty subscription list → no-op (never touches the push service).
 *   4. Fan-out sends to every active subscription.
 *   5. Auto-prune on 404 / 410 (marks subscription disabled).
 *   6. Transient errors (500 / network) DON'T disable subscriptions.
 *
 * Boundaries mocked:
 *   - `web-push` (send function).
 *   - `@/lib/push/repository` (list + mark + touch).
 *   - `@/lib/notifications/preferences` + `.../categories` (isChannelEnabled + categoryForKind).
 */

vi.mock("server-only", () => ({}));

// Default: VAPID configured so the module treats itself as ready.
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BExamplePublicKey";
process.env.VAPID_PRIVATE_KEY = "example-private-key";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}));

const listActiveMock = vi.fn();
const markDisabledMock = vi.fn();
const touchMock = vi.fn();

vi.mock("@/lib/push/repository", () => ({
  listActiveSubscriptionsForUser: listActiveMock,
  markSubscriptionDisabled: markDisabledMock,
  touchSubscription: touchMock,
}));

const isChannelEnabledMock = vi.fn();

vi.mock("@/lib/notifications/preferences", () => ({
  isChannelEnabled: isChannelEnabledMock,
}));

vi.mock("@/lib/notifications/categories", () => ({
  categoryForKind: () => "APPROVALS",
}));

vi.mock("@/lib/observability/log", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function importDispatcher() {
  vi.resetModules();
  return await import("./send");
}

const goodSubscription = {
  id: "sub-1",
  tenantId: "tenant-1",
  userId: "user-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "p", auth: "a" },
  userAgent: null,
  createdAt: "2026-01-01T00:00:00Z",
  lastUsedAt: null,
  disabledAt: null,
};

const secondSubscription = {
  ...goodSubscription,
  id: "sub-2",
  endpoint: "https://fcm.googleapis.com/fcm/send/def",
};

const commonPayload = {
  tenantId: "tenant-1",
  userId: "user-1",
  kind: "APPROVAL_REQUESTED" as const,
  title: "Approval dibutuhkan",
  body: "Expense IDR 15M butuh approval kamu",
  actionUrl: "/approvals/expense/xyz",
};

beforeEach(() => {
  sendNotificationMock.mockReset();
  setVapidDetailsMock.mockReset();
  listActiveMock.mockReset();
  markDisabledMock.mockReset();
  touchMock.mockReset();
  isChannelEnabledMock.mockReset();
  isChannelEnabledMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.resetModules();
});

describe("dispatchWebPush", () => {
  it("no-ops silently when VAPID env vars are missing", async () => {
    const savedPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    try {
      const { dispatchWebPush } = await importDispatcher();
      await dispatchWebPush(commonPayload);
      expect(sendNotificationMock).not.toHaveBeenCalled();
      expect(listActiveMock).not.toHaveBeenCalled();
    } finally {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = savedPub;
    }
  });

  it("short-circuits when the user has PUSH disabled for the category", async () => {
    isChannelEnabledMock.mockResolvedValueOnce(false);
    const { dispatchWebPush } = await importDispatcher();
    await dispatchWebPush(commonPayload);
    expect(isChannelEnabledMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      category: "APPROVALS",
      channel: "PUSH",
    });
    expect(listActiveMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("no-ops when the user has zero active subscriptions", async () => {
    listActiveMock.mockResolvedValueOnce([]);
    const { dispatchWebPush } = await importDispatcher();
    await dispatchWebPush(commonPayload);
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(markDisabledMock).not.toHaveBeenCalled();
  });

  it("fans out to every active subscription in parallel", async () => {
    listActiveMock.mockResolvedValueOnce([goodSubscription, secondSubscription]);
    sendNotificationMock.mockResolvedValue({ statusCode: 201 });

    const { dispatchWebPush } = await importDispatcher();
    await dispatchWebPush(commonPayload);

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    // Payload MUST carry the kind as `tag` so bursts collapse.
    const firstArgs = sendNotificationMock.mock.calls[0];
    const payload = JSON.parse(firstArgs[1] as string);
    expect(payload).toMatchObject({
      title: "Approval dibutuhkan",
      body: "Expense IDR 15M butuh approval kamu",
      url: "/approvals/expense/xyz",
      tag: "APPROVAL_REQUESTED",
    });
    // touchSubscription bumped once per successful send.
    expect(touchMock).toHaveBeenCalledTimes(2);
    expect(markDisabledMock).not.toHaveBeenCalled();
  });

  it("auto-prunes subscriptions when the push service returns 410 (gone)", async () => {
    listActiveMock.mockResolvedValueOnce([goodSubscription]);
    sendNotificationMock.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { statusCode: 410 }),
    );

    const { dispatchWebPush } = await importDispatcher();
    await dispatchWebPush(commonPayload);

    expect(markDisabledMock).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      reason: "push_service_410",
    });
    expect(touchMock).not.toHaveBeenCalled();
  });

  it("auto-prunes on 404 (endpoint unknown) too", async () => {
    listActiveMock.mockResolvedValueOnce([goodSubscription]);
    sendNotificationMock.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
    const { dispatchWebPush } = await importDispatcher();
    await dispatchWebPush(commonPayload);
    expect(markDisabledMock).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      reason: "push_service_404",
    });
  });

  it("does NOT disable subscriptions on transient errors (500 / network)", async () => {
    listActiveMock.mockResolvedValueOnce([goodSubscription]);
    sendNotificationMock.mockRejectedValueOnce(
      Object.assign(new Error("upstream 500"), { statusCode: 500 }),
    );

    const { dispatchWebPush } = await importDispatcher();
    await dispatchWebPush(commonPayload);

    expect(markDisabledMock).not.toHaveBeenCalled();
    expect(touchMock).not.toHaveBeenCalled();
  });

  it("continues fan-out even if one device fails", async () => {
    listActiveMock.mockResolvedValueOnce([goodSubscription, secondSubscription]);
    sendNotificationMock
      .mockRejectedValueOnce(
        Object.assign(new Error("gone"), { statusCode: 410 }),
      )
      .mockResolvedValueOnce({ statusCode: 201 });

    const { dispatchWebPush } = await importDispatcher();
    await dispatchWebPush(commonPayload);

    // sub-1 pruned, sub-2 touched.
    expect(markDisabledMock).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      reason: "push_service_410",
    });
    expect(touchMock).toHaveBeenCalledWith({ subscriptionId: "sub-2" });
  });
});
