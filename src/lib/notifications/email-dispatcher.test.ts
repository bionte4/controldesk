import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-item email dispatcher tests. The dispatcher walks four gates:
 *   kind allowlist → preference toggle → recipient email → tenant meta.
 * Each test exercises exactly one of these fences plus the happy path.
 *
 * All boundaries (Supabase, mailer, root domain) are mocked at module
 * scope so we can assert on the exact payload the caller composes,
 * not just the fact that "something happened".
 */

vi.mock("server-only", () => ({}));

// Shared Supabase builder that lets tests configure per-table returns.
type QueryHandler = () => Promise<{ data: unknown; error: null }>;
type InsertHandler = (row: Record<string, unknown>) => Promise<{ error: null | { message: string } }>;

const employeesGet = vi.fn<QueryHandler>();
const tenantsGet = vi.fn<QueryHandler>();
const outboxInsert = vi.fn<InsertHandler>();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      if (table === "employees") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: employeesGet,
              }),
            }),
          }),
        };
      }
      if (table === "tenants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: tenantsGet,
            }),
          }),
        };
      }
      if (table === "email_outbox") {
        return {
          insert: (row: Record<string, unknown>) => outboxInsert(row),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const sendEmailMock = vi.fn(async () => ({
  status: "SENT" as const,
  provider: "smtp" as const,
  from: "ControlDesk <no-reply@acme.controldesk.app>",
  providerMessageId: "msg-1",
  configSource: "tenant" as const,
}));
vi.mock("@/lib/notify/mailer", () => ({
  sendEmail: sendEmailMock,
}));

const isChannelEnabledMock = vi.fn(async () => true);
vi.mock("./preferences", () => ({
  isChannelEnabled: isChannelEnabledMock,
}));

vi.mock("@/lib/tenant/resolve", () => ({
  getRootDomain: () => "controldesk.test",
}));

vi.mock("@/lib/observability/log", () => ({
  log: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
}));

async function loadDispatcher() {
  // Import fresh so `React.cache()` on the tenant loader doesn't
  // carry state across tests (cache is per-import).
  vi.resetModules();
  return await import("./email-dispatcher");
}

const baseCall = {
  tenantId: "t1",
  userId: "u1",
  employeeId: "e1",
  kind: "APPROVAL_REQUESTED" as const,
  title: "Approve me",
  body: "IDR 3.500.000 — expense from Andi.",
  actionUrl: "/finance/expenses/xyz",
};

describe("dispatchNotificationEmail", () => {
  beforeEach(() => {
    employeesGet.mockReset();
    tenantsGet.mockReset();
    outboxInsert.mockReset();
    sendEmailMock.mockClear();
    isChannelEnabledMock.mockClear();
    isChannelEnabledMock.mockImplementation(async () => true);

    employeesGet.mockImplementation(async () => ({
      data: {
        email: "andi@acme.co.id",
        full_name: "Andi",
        preferred_locale: "id",
      },
      error: null,
    }));
    tenantsGet.mockImplementation(async () => ({
      data: { name: "PT Acme Nusantara", slug: "acme" },
      error: null,
    }));
    outboxInsert.mockImplementation(async () => ({ error: null }));
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("sends when kind is allowlisted, preference ON, recipient email + tenant meta present", async () => {
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail(baseCall);

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const sendArgs = sendEmailMock.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
      tenantId: string;
    };
    expect(sendArgs.to).toBe("andi@acme.co.id");
    expect(sendArgs.subject).toBe("[PT Acme Nusantara] Approve me");
    expect(sendArgs.tenantId).toBe("t1");
    expect(sendArgs.html).toContain("Approve me");
    expect(sendArgs.html).toContain("Halo Andi,");
    // Absolute URL on tenant subdomain + from=email marker for Pola A audit.
    expect(sendArgs.html).toContain(
      "https://acme.controldesk.test/finance/expenses/xyz?from=email",
    );

    expect(outboxInsert).toHaveBeenCalledOnce();
    const outboxRow = outboxInsert.mock.calls[0]?.[0] as {
      tenant_id: string;
      to_address: string;
      status: string;
      provider: string;
      metadata: Record<string, unknown>;
    };
    expect(outboxRow.tenant_id).toBe("t1");
    expect(outboxRow.to_address).toBe("andi@acme.co.id");
    expect(outboxRow.status).toBe("SENT");
    expect(outboxRow.provider).toBe("smtp");
    expect(outboxRow.metadata.kind).toBe("APPROVAL_REQUESTED");
    expect(outboxRow.metadata.source).toBe("notify_user");
  });

  it("short-circuits for kinds not on the email allowlist (e.g. timesheet approvals)", async () => {
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail({
      ...baseCall,
      kind: "TIMESHEET_APPROVED",
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(outboxInsert).not.toHaveBeenCalled();
    // We short-circuit BEFORE checking preferences so the cheap gate wins.
    expect(isChannelEnabledMock).not.toHaveBeenCalled();
    expect(employeesGet).not.toHaveBeenCalled();
  });

  it("honours the user's EMAIL preference when disabled for the category", async () => {
    isChannelEnabledMock.mockImplementation(async () => false);
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail(baseCall);

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(outboxInsert).not.toHaveBeenCalled();
    // Should not have touched the DB after the preference miss.
    expect(employeesGet).not.toHaveBeenCalled();
  });

  it("skips gracefully when the recipient has no email address on file", async () => {
    employeesGet.mockImplementation(async () => ({
      data: { email: null, full_name: "Ghost User", preferred_locale: null },
      error: null,
    }));
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail(baseCall);

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(outboxInsert).not.toHaveBeenCalled();
  });

  it("skips when the tenant row cannot be resolved", async () => {
    tenantsGet.mockImplementation(async () => ({ data: null, error: null }));
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail(baseCall);

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(outboxInsert).not.toHaveBeenCalled();
  });

  it("still persists a FAILED outbox row so ops can trace the send outcome", async () => {
    sendEmailMock.mockImplementationOnce(async () => ({
      status: "FAILED" as const,
      provider: "smtp" as const,
      error: "connection refused",
    }));
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail(baseCall);

    expect(outboxInsert).toHaveBeenCalledOnce();
    const outboxRow = outboxInsert.mock.calls[0]?.[0] as {
      status: string;
      error_message: string;
      sent_at: string | null;
    };
    expect(outboxRow.status).toBe("FAILED");
    expect(outboxRow.error_message).toBe("connection refused");
    expect(outboxRow.sent_at).toBeNull();
  });

  it("omits the CTA entirely when the caller did not pass an actionUrl", async () => {
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail({ ...baseCall, actionUrl: undefined });

    const sendArgs = sendEmailMock.mock.calls[0]?.[0] as { html: string };
    expect(sendArgs.html).not.toContain("Buka di ControlDesk");
    expect(sendArgs.html).not.toContain("from=email");
  });

  it("inserts ?from=email BEFORE the URL fragment (budget-request deep-links)", async () => {
    // Budget request notifyRoles calls ship URLs like
    //   `/finance/budgets/{id}#br-{brid}`
    // Naively appending `?from=email` at the end produces
    //   `/finance/budgets/{id}#br-{brid}?from=email`
    // where the query becomes part of the fragment and never lands as
    // Referer. The audit auto-tag in `recordAudit()` would then miss.
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail({
      ...baseCall,
      actionUrl: "/finance/budgets/bud-1#br-2",
    });

    const sendArgs = sendEmailMock.mock.calls[0]?.[0] as { html: string };
    expect(sendArgs.html).toContain(
      "https://acme.controldesk.test/finance/budgets/bud-1?from=email#br-2",
    );
    // Sanity: the malformed form must NOT appear.
    expect(sendArgs.html).not.toContain("#br-2?from=email");
  });

  it("appends with & when actionUrl already has a query string", async () => {
    const { dispatchNotificationEmail } = await loadDispatcher();
    await dispatchNotificationEmail({
      ...baseCall,
      actionUrl: "/approvals?tab=pending",
    });

    // Check the plain-text body — HTML would escape `&` to `&amp;`,
    // and we care that the URL is well-formed at the wire level, not
    // its DOM escaping.
    const sendArgs = sendEmailMock.mock.calls[0]?.[0] as { text: string };
    expect(sendArgs.text).toContain(
      "https://acme.controldesk.test/approvals?tab=pending&from=email",
    );
  });
});
