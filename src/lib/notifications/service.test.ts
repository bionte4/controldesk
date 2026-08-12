import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Service-level fan-out tests. Because `service.ts` imports
 * `server-only`, Supabase, and the Telegram/WhatsApp clients, we mock
 * every boundary via `vi.mock` at file scope. The tests only exercise
 * the composition logic — enqueue then side-channel push — not the
 * clients themselves (those have their own tests).
 */

vi.mock("server-only", () => ({}));

const rpcMock = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: rpcMock,
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
      }),
    }),
  }),
}));

const sendTelegramMessageMock = vi.fn(async () => undefined);
vi.mock("@/lib/integrations/telegram/client", () => ({
  sendTelegramMessage: sendTelegramMessageMock,
}));

const telegramLink = { tenantId: "t1", userId: "u1", chatId: "42" };
const loadTelegramLinkMock = vi.fn(async () => telegramLink);
vi.mock("@/lib/integrations/telegram/repository", () => ({
  loadUserLink: loadTelegramLinkMock,
}));

type WhatsAppSendArgs = { tenantId: string; waId: string; text: string };
type WhatsAppSendResult = {
  ok: boolean;
  providerMessageId: string;
  provider: string;
};
const sendWhatsAppMessageMock = vi.fn<
  (args: WhatsAppSendArgs) => Promise<WhatsAppSendResult>
>(async () => ({
  ok: true,
  providerMessageId: "wamid.abc",
  provider: "FONNTE",
}));
vi.mock("@/lib/integrations/whatsapp/client", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

type WhatsappLink = {
  tenantId: string;
  userId: string;
  waId: string;
  displayName: string | null;
  profileName: string | null;
};
const whatsappLink: WhatsappLink = {
  tenantId: "t1",
  userId: "u1",
  waId: "+628123456789",
  displayName: null,
  profileName: null,
};
const loadWhatsappLinkMock = vi.fn<() => Promise<WhatsappLink | null>>(
  async () => whatsappLink,
);
vi.mock("@/lib/integrations/whatsapp/repository", () => ({
  loadUserWhatsAppLink: loadWhatsappLinkMock,
}));

// Signature mirrors `isChannelEnabled` — tests below inspect args to
// suppress a specific channel while leaving the others intact.
type IsChannelEnabledArgs = {
  tenantId: string;
  userId: string;
  category: string;
  channel: string;
};
const isChannelEnabledMock = vi.fn<
  (args: IsChannelEnabledArgs) => Promise<boolean>
>(async () => true);
vi.mock("./preferences", () => ({
  isChannelEnabled: isChannelEnabledMock,
}));

vi.mock("./categories", () => ({
  categoryForKind: () => "APPROVALS",
}));

// Email dispatcher has its own dedicated test (email-dispatcher.test.ts).
// Here we only care that notifyUser fires it exactly once when tenantId
// is supplied — a no-op mock keeps this suite scoped to fan-out orchestration.
type DispatchEmailArgs = {
  tenantId: string;
  userId: string;
  employeeId?: string | null;
  kind: string;
  title: string;
  body?: string;
  actionUrl?: string;
};
const dispatchNotificationEmailMock = vi.fn<
  (args: DispatchEmailArgs) => Promise<void>
>(async () => undefined);
vi.mock("./email-dispatcher", () => ({
  dispatchNotificationEmail: dispatchNotificationEmailMock,
}));

vi.mock("@/lib/observability/log", () => ({
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

/** Yield once so `void promise().catch()` scheduled inside notifyUser can settle before we assert. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("notifyUser side-channel fan-out", () => {
  beforeEach(() => {
    rpcMock.mockClear();
    sendTelegramMessageMock.mockClear();
    loadTelegramLinkMock.mockClear();
    sendWhatsAppMessageMock.mockClear();
    loadWhatsappLinkMock.mockClear();
    isChannelEnabledMock.mockClear();
    dispatchNotificationEmailMock.mockClear();
    isChannelEnabledMock.mockImplementation(async () => true);
    loadWhatsappLinkMock.mockImplementation(async () => whatsappLink);
    loadTelegramLinkMock.mockImplementation(async () => telegramLink);
    sendWhatsAppMessageMock.mockImplementation(
      async () =>
        ({ ok: true, providerMessageId: "wamid.abc", provider: "FONNTE" }) as const,
    );
    dispatchNotificationEmailMock.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("fires Telegram, WhatsApp AND Email side channels in parallel when opted-in", async () => {
    const { notifyUser } = await import("./service");
    const res = await notifyUser({
      recipient: { userId: "u1", employeeId: "e1" },
      kind: "APPROVAL_REQUESTED",
      title: "Approve me",
      body: "IDR 1,000,000",
      actionUrl: "https://acme.controldesk.app/approvals/x",
      tenantId: "t1",
    });
    expect(res.ok).toBe(true);
    await flushMicrotasks();

    expect(rpcMock).toHaveBeenCalledOnce();
    expect(sendTelegramMessageMock).toHaveBeenCalledOnce();
    expect(sendWhatsAppMessageMock).toHaveBeenCalledOnce();
    expect(dispatchNotificationEmailMock).toHaveBeenCalledOnce();

    const wa = sendWhatsAppMessageMock.mock.calls[0]![0] as {
      tenantId: string;
      waId: string;
      text: string;
    };
    expect(wa.tenantId).toBe("t1");
    expect(wa.waId).toBe("+628123456789");
    expect(wa.text).toContain("*Approve me*");

    const emailArgs = dispatchNotificationEmailMock.mock.calls[0]![0] as {
      tenantId: string;
      userId: string;
      employeeId: string | null;
      kind: string;
      title: string;
      body: string;
      actionUrl: string;
    };
    expect(emailArgs.tenantId).toBe("t1");
    expect(emailArgs.userId).toBe("u1");
    expect(emailArgs.employeeId).toBe("e1");
    expect(emailArgs.kind).toBe("APPROVAL_REQUESTED");
    expect(emailArgs.actionUrl).toBe(
      "https://acme.controldesk.app/approvals/x",
    );
  });

  it("suppresses the WhatsApp channel when the user opted out of that category (email still fires)", async () => {
    isChannelEnabledMock.mockImplementation(async (args) => {
      return args.channel !== "WHATSAPP";
    });
    const { notifyUser } = await import("./service");
    await notifyUser({
      recipient: { userId: "u1", employeeId: "e1" },
      kind: "APPROVAL_REQUESTED",
      title: "hi",
      tenantId: "t1",
    });
    await flushMicrotasks();

    expect(sendTelegramMessageMock).toHaveBeenCalledOnce();
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
    // Email dispatcher is invoked even when WhatsApp is off — the
    // dispatcher itself has its own EMAIL preference gate.
    expect(dispatchNotificationEmailMock).toHaveBeenCalledOnce();
  });

  it("skips WhatsApp when the user has not linked a number", async () => {
    loadWhatsappLinkMock.mockImplementation(async () => null);
    const { notifyUser } = await import("./service");
    await notifyUser({
      recipient: { userId: "u1", employeeId: "e1" },
      kind: "APPROVAL_REQUESTED",
      title: "hi",
      tenantId: "t1",
    });
    await flushMicrotasks();

    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  it("does not attempt side-channel fan-out when tenantId is omitted (legacy caller)", async () => {
    const { notifyUser } = await import("./service");
    await notifyUser({
      recipient: { userId: "u1", employeeId: "e1" },
      kind: "APPROVAL_REQUESTED",
      title: "hi",
      // no tenantId
    });
    await flushMicrotasks();

    expect(rpcMock).toHaveBeenCalledOnce();
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEmailMock).not.toHaveBeenCalled();
  });

  it("skips notification entirely when recipient has no user_id", async () => {
    const { notifyUser } = await import("./service");
    const res = await notifyUser({
      recipient: { userId: null, employeeId: "e1" },
      kind: "APPROVAL_REQUESTED",
      title: "hi",
      tenantId: "t1",
    });
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe("no_user");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
