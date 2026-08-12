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

const sendWhatsAppMessageMock = vi.fn(
  async () =>
    ({ ok: true, providerMessageId: "wamid.abc", provider: "FONNTE" }) as const,
);
vi.mock("@/lib/integrations/whatsapp/client", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

const whatsappLink = {
  tenantId: "t1",
  userId: "u1",
  waId: "+628123456789",
  displayName: null,
  profileName: null,
};
const loadWhatsappLinkMock = vi.fn(async () => whatsappLink);
vi.mock("@/lib/integrations/whatsapp/repository", () => ({
  loadUserWhatsAppLink: loadWhatsappLinkMock,
}));

const isChannelEnabledMock = vi.fn(async () => true);
vi.mock("./preferences", () => ({
  isChannelEnabled: isChannelEnabledMock,
}));

vi.mock("./categories", () => ({
  categoryForKind: () => "APPROVALS",
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
    isChannelEnabledMock.mockImplementation(async () => true);
    loadWhatsappLinkMock.mockImplementation(async () => whatsappLink);
    loadTelegramLinkMock.mockImplementation(async () => telegramLink);
    sendWhatsAppMessageMock.mockImplementation(
      async () =>
        ({ ok: true, providerMessageId: "wamid.abc", provider: "FONNTE" }) as const,
    );
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("fires Telegram AND WhatsApp side channels in parallel when both are opted-in", async () => {
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
    const call = sendWhatsAppMessageMock.mock.calls[0]?.[0] as {
      tenantId: string;
      waId: string;
      text: string;
    };
    expect(call.tenantId).toBe("t1");
    expect(call.waId).toBe("+628123456789");
    expect(call.text).toContain("*Approve me*");
    expect(call.text).toContain("IDR 1,000,000");
    expect(call.text).toContain("https://acme.controldesk.app/approvals/x");
  });

  it("suppresses the WhatsApp channel when the user opted out of that category", async () => {
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
