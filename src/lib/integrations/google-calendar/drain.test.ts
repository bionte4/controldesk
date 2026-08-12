import { beforeAll, describe, expect, it } from "vitest";

import { encryptToken } from "@/lib/security/token-crypto";
import { drainCalendarOutbox, __internals } from "./drain";
import type {
  CalendarEventDispatch,
  CalendarPublishResult,
  CalendarPublisher,
  TenantCalendarCredentials,
} from "./types";

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase fake
//
// We stub only the surface `drainCalendarOutbox` actually calls:
//   - .from(<table>).select(...).in(...).lte(...).order(...).limit(...)
//   - .from("projects").select(...).in(...)
//   - .from("project_milestones").select(...).in(...)
//   - .from("project_calendar_events").update(...).eq("id", ...)
//   - .rpc("get_google_credential_refresh_token", {...})
//
// This is the DI convention used elsewhere in the repo (see mailer.test.ts).
// ---------------------------------------------------------------------------

type OutboxRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  milestone_id: string | null;
  kind: string;
  status: string;
  attempts: number;
  google_event_id: string | null;
  payload: unknown;
  scheduled_at?: string;
  sent_at?: string | null;
  last_error?: string | null;
  updated_at?: string;
};

type ProjectRow = {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  project_number: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  sync_calendar: boolean;
};

type MilestoneRow = {
  id: string;
  project_id: string;
  name: string;
  planned_end_date: string | null;
};

type CredentialRow = {
  tenant_id: string;
  encrypted_refresh_token: string;
  calendar_id: string;
  client_email: string | null;
  is_active: boolean;
};

type FakeDB = {
  outbox: OutboxRow[];
  projects: ProjectRow[];
  milestones: MilestoneRow[];
  credsByTenant: Record<string, CredentialRow | null>;
};

function makeFakeSupabase(db: FakeDB) {
  return {
    from(table: string) {
      if (table === "project_calendar_events") {
        return {
          select() {
            const q = {
              _rows: db.outbox,
              in(_col: string, values: string[]) {
                q._rows = q._rows.filter((r) =>
                  values.includes((r as unknown as Record<string, string>)[_col]!),
                );
                return q;
              },
              lte(_col: string, _iso: string) {
                return q;
              },
              order() {
                return q;
              },
              async limit(n: number) {
                return { data: q._rows.slice(0, n), error: null };
              },
            };
            return q;
          },
          update(patch: Partial<OutboxRow>) {
            return {
              async eq(_col: string, id: string) {
                const row = db.outbox.find((r) => r.id === id);
                if (row) Object.assign(row, patch);
                return { data: null, error: null };
              },
            };
          },
        };
      }

      if (table === "projects") {
        return {
          select() {
            return {
              async in(_col: string, ids: string[]) {
                return {
                  data: db.projects.filter((p) => ids.includes(p.id)),
                  error: null,
                };
              },
            };
          },
        };
      }

      if (table === "project_milestones") {
        return {
          select() {
            return {
              async in(_col: string, ids: string[]) {
                return {
                  data: db.milestones.filter((m) => ids.includes(m.id)),
                  error: null,
                };
              },
            };
          },
        };
      }

      if (table === "google_calendar_credentials") {
        return {
          select() {
            const q = {
              _tenantIds: [] as string[],
              _activeOnly: false,
              in(_col: string, ids: string[]) {
                q._tenantIds = ids;
                return q;
              },
              async eq(col: string, val: unknown) {
                if (col === "is_active") q._activeOnly = val === true;
                const rows = q._tenantIds
                  .map((tid) => db.credsByTenant[tid])
                  .filter((r): r is CredentialRow => !!r)
                  .filter((r) => (q._activeOnly ? r.is_active : true));
                return { data: rows, error: null };
              },
            };
            return q;
          },
        };
      }

      throw new Error(`fake supabase: unexpected table ${table}`);
    },
  } as unknown as Parameters<typeof drainCalendarOutbox>[0]["supabase"];
}

function makeSpyPublisher(
  results: CalendarPublishResult[],
): CalendarPublisher & { calls: Array<CalendarEventDispatch> } {
  const calls: CalendarEventDispatch[] = [];
  let idx = 0;
  const pub: CalendarPublisher & { calls: typeof calls } = {
    name: "spy",
    calls,
    async publish(
      _creds: TenantCalendarCredentials,
      dispatch: CalendarEventDispatch,
    ) {
      calls.push(dispatch);
      return results[idx++] ?? { status: "SENT", googleEventId: "spy-event" };
    },
  };
  return pub;
}

// Fixed master key so encryptToken() succeeds deterministically inside the
// fixtures below. Set once before all tests via beforeAll (mutating
// process.env in module scope races the imports).
const TEST_MASTER_KEY = "test-master-key-32-chars-min-length-abcdef";
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = TEST_MASTER_KEY;
});

function fakeCred(tenantId: string): CredentialRow {
  return {
    tenant_id: tenantId,
    encrypted_refresh_token: encryptToken(`refresh-token-for-${tenantId}`),
    calendar_id: "primary",
    client_email: null,
    is_active: true,
  };
}

const TENANT_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const PROJ_1 = "11111111-1111-4111-1111-111111111111";
const PROJ_2 = "22222222-2222-4222-2222-222222222222";

function baseProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: PROJ_1,
    tenant_id: TENANT_A,
    name: "Payroll Migration",
    code: "PRJ-2026-0001",
    project_number: "PRJ-2026-0001",
    description: "Move payroll off legacy vendor.",
    start_date: "2026-08-01",
    end_date: "2026-12-31",
    location: "Jakarta HQ",
    sync_calendar: true,
    ...overrides,
  };
}

function baseOutbox(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "outbox-1",
    tenant_id: TENANT_A,
    project_id: PROJ_1,
    milestone_id: null,
    kind: "PROJECT_CREATED",
    status: "PENDING",
    attempts: 0,
    google_event_id: null,
    payload: {},
    ...overrides,
  };
}

describe("drainCalendarOutbox", () => {
  it("returns zero-work result when the outbox is empty", async () => {
    const db: FakeDB = {
      outbox: [],
      projects: [],
      milestones: [],
      credsByTenant: {},
    };
    const publisher = makeSpyPublisher([]);
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: false,
      startedAt: new Date("2026-08-07T00:00:00Z"),
      batchSize: 50,
    });
    expect(res).toEqual({ total: 0, sent: 0, failed: 0, skipped: 0 });
    expect(publisher.calls).toHaveLength(0);
  });

  it("marks rows SKIPPED when the tenant has no active credentials", async () => {
    const db: FakeDB = {
      outbox: [baseOutbox()],
      projects: [baseProject()],
      milestones: [],
      credsByTenant: { [TENANT_A]: null },
    };
    const publisher = makeSpyPublisher([]);
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: false,
      startedAt: new Date(),
      batchSize: 50,
    });
    expect(res).toMatchObject({ total: 1, sent: 0, skipped: 1, failed: 0 });
    expect(publisher.calls).toHaveLength(0);
    expect(db.outbox[0]!.status).toBe("SKIPPED");
    expect(db.outbox[0]!.last_error).toMatch(/No active google_calendar_credentials/);
  });

  it("marks rows SKIPPED when the hydrated project has sync_calendar=false", async () => {
    // Guards against the case where the tenant admin toggled sync_calendar
    // off between enqueue and drain. Publishing stale state would be a
    // silent leak of confidential engagements.
    const db: FakeDB = {
      outbox: [baseOutbox()],
      projects: [baseProject({ sync_calendar: false })],
      milestones: [],
      credsByTenant: {
        [TENANT_A]: fakeCred(TENANT_A),
      },
    };
    const publisher = makeSpyPublisher([]);
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: false,
      startedAt: new Date(),
      batchSize: 50,
    });
    expect(res).toMatchObject({ skipped: 1, sent: 0, failed: 0 });
    expect(publisher.calls).toHaveLength(0);
    expect(db.outbox[0]!.status).toBe("SKIPPED");
    expect(db.outbox[0]!.last_error).toMatch(/sync_calendar=false/);
  });

  it("dispatches a PENDING row to the publisher and marks it SENT", async () => {
    const db: FakeDB = {
      outbox: [baseOutbox()],
      projects: [baseProject()],
      milestones: [],
      credsByTenant: {
        [TENANT_A]: fakeCred(TENANT_A),
      },
    };
    const publisher = makeSpyPublisher([
      { status: "SENT", googleEventId: "gcal-abc" },
    ]);
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: false,
      startedAt: new Date("2026-08-07T00:00:00Z"),
      batchSize: 50,
    });
    expect(res).toMatchObject({ total: 1, sent: 1, skipped: 0, failed: 0 });
    expect(publisher.calls).toHaveLength(1);
    expect(publisher.calls[0]!.kind).toBe("PROJECT_CREATED");
    expect(publisher.calls[0]!.project.number).toBe("PRJ-2026-0001");
    expect(db.outbox[0]!.status).toBe("SENT");
    expect(db.outbox[0]!.google_event_id).toBe("gcal-abc");
    expect(db.outbox[0]!.attempts).toBe(1);
  });

  it("dry_run does NOT publish and does NOT write DB updates", async () => {
    const db: FakeDB = {
      outbox: [baseOutbox()],
      projects: [baseProject()],
      milestones: [],
      credsByTenant: {
        [TENANT_A]: fakeCred(TENANT_A),
      },
    };
    const publisher = makeSpyPublisher([]);
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: true,
      startedAt: new Date(),
      batchSize: 50,
    });
    expect(res).toMatchObject({ sent: 1, total: 1 });
    // Publisher NOT called in dry_run; DB row unchanged.
    expect(publisher.calls).toHaveLength(0);
    expect(db.outbox[0]!.status).toBe("PENDING");
    expect(db.outbox[0]!.google_event_id).toBeNull();
  });

  it("classifies retryable failures as FAILED with attempts++ and exponential backoff", async () => {
    const startedAt = new Date("2026-08-07T00:00:00Z");
    const db: FakeDB = {
      outbox: [baseOutbox({ attempts: 2 })],
      projects: [baseProject()],
      milestones: [],
      credsByTenant: {
        [TENANT_A]: fakeCred(TENANT_A),
      },
    };
    const publisher = makeSpyPublisher([
      { status: "FAILED", error: "5xx from Google", retryable: true },
    ]);
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: false,
      startedAt,
      batchSize: 50,
    });
    expect(res).toMatchObject({ failed: 1, sent: 0 });
    expect(db.outbox[0]!.status).toBe("FAILED");
    expect(db.outbox[0]!.attempts).toBe(3);
    // 2^3 = 8 minutes ahead.
    const scheduled = new Date(db.outbox[0]!.scheduled_at!).getTime();
    expect(scheduled - startedAt.getTime()).toBe(8 * 60_000);
    expect(db.outbox[0]!.last_error).toMatch(/5xx from Google/);
  });

  it("classifies non-retryable failures as SKIPPED (do not backoff-retry a 4xx)", async () => {
    const db: FakeDB = {
      outbox: [baseOutbox()],
      projects: [baseProject()],
      milestones: [],
      credsByTenant: {
        [TENANT_A]: fakeCred(TENANT_A),
      },
    };
    const publisher = makeSpyPublisher([
      { status: "FAILED", error: "invalid calendarId", retryable: false },
    ]);
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: false,
      startedAt: new Date(),
      batchSize: 50,
    });
    expect(res).toMatchObject({ skipped: 1, failed: 0 });
    expect(db.outbox[0]!.status).toBe("SKIPPED");
  });

  it("routes MILESTONE_CREATED rows through the milestone hydration path", async () => {
    const milestoneId = "mmmm3333-mmmm-4mmm-mmmm-mmmmmmmmmmmm";
    const db: FakeDB = {
      outbox: [
        baseOutbox({
          id: "outbox-ms-1",
          milestone_id: milestoneId,
          kind: "MILESTONE_CREATED",
        }),
      ],
      projects: [baseProject()],
      milestones: [
        {
          id: milestoneId,
          project_id: PROJ_1,
          name: "Cutover to new payroll vendor",
          planned_end_date: "2026-10-15",
        },
      ],
      credsByTenant: {
        [TENANT_A]: fakeCred(TENANT_A),
      },
    };
    const publisher = makeSpyPublisher([
      { status: "SENT", googleEventId: "gcal-ms-1" },
    ]);
    await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: false,
      startedAt: new Date(),
      batchSize: 50,
    });
    expect(publisher.calls[0]!.milestone).toMatchObject({
      id: milestoneId,
      name: "Cutover to new payroll vendor",
      dueDate: "2026-10-15",
    });
  });

  it("handles multi-tenant batches by looking up credentials per tenant", async () => {
    const db: FakeDB = {
      outbox: [
        baseOutbox({ id: "a1", tenant_id: TENANT_A, project_id: PROJ_1 }),
        baseOutbox({ id: "b1", tenant_id: TENANT_B, project_id: PROJ_2 }),
      ],
      projects: [
        baseProject(),
        baseProject({ id: PROJ_2, tenant_id: TENANT_B, project_number: "PRJ-2026-0002" }),
      ],
      milestones: [],
      credsByTenant: {
        [TENANT_A]: fakeCred(TENANT_A),
        // Tenant B has no creds — its row should SKIP.
        [TENANT_B]: null,
      },
    };
    const publisher = makeSpyPublisher([
      { status: "SENT", googleEventId: "gcal-a1" },
    ]);
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher,
      dryRun: false,
      startedAt: new Date(),
      batchSize: 50,
    });
    expect(res).toMatchObject({ total: 2, sent: 1, skipped: 1 });
    expect(publisher.calls).toHaveLength(1);
    expect(publisher.calls[0]!.tenantId).toBe(TENANT_A);
  });
});

describe("drain backoff schedule", () => {
  it("doubles per attempt, capped at 6 hours (360 min)", () => {
    expect(__internals.backoffMinutes(1)).toBe(2);
    expect(__internals.backoffMinutes(2)).toBe(4);
    expect(__internals.backoffMinutes(3)).toBe(8);
    expect(__internals.backoffMinutes(4)).toBe(16);
    expect(__internals.backoffMinutes(5)).toBe(32);
    expect(__internals.backoffMinutes(6)).toBe(64);
    expect(__internals.backoffMinutes(7)).toBe(128);
    expect(__internals.backoffMinutes(8)).toBe(256);
    expect(__internals.backoffMinutes(9)).toBe(360);
    expect(__internals.backoffMinutes(10)).toBe(360);
    expect(__internals.backoffMinutes(20)).toBe(360);
  });
});

describe("drain end-to-end with NoopCalendarPublisher", () => {
  it("marks rows SENT with a synthetic noop-* event id", async () => {
    const { NoopCalendarPublisher } = await import("./noop");
    const db: FakeDB = {
      outbox: [baseOutbox()],
      projects: [baseProject()],
      milestones: [],
      credsByTenant: {
        [TENANT_A]: fakeCred(TENANT_A),
      },
    };
    const res = await drainCalendarOutbox({
      supabase: makeFakeSupabase(db),
      publisher: new NoopCalendarPublisher(),
      dryRun: false,
      startedAt: new Date(),
      batchSize: 50,
    });
    expect(res).toMatchObject({ sent: 1, total: 1 });
    expect(db.outbox[0]!.status).toBe("SENT");
    expect(db.outbox[0]!.google_event_id).toMatch(/^noop-/);
  });
});
