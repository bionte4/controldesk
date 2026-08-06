import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetSinkForTests,
  __setSinkForTests,
  AxiomSink,
  ConsoleSink,
  NoOpSink,
  SentrySink,
  parseStackTrace,
  redactPayload,
  resolveSink,
  type Sink,
  type SinkEvent,
} from "./sink";

const BASE_EVENT: SinkEvent = {
  level: "error",
  msg: "boom",
  ts: "2026-08-05T02:59:47.312Z",
};

describe("redactPayload", () => {
  it("redacts sensitive keys and Bearer tokens", () => {
    const scrubbed = redactPayload({
      authorization: "Bearer abcdef1234567890abcdef1234567890",
      cookie: "session=abc",
      password: "hunter2",
      api_key: "xyz",
      note: "call Bearer abcdef1234567890abcdef1234567890 to test",
    });
    expect(scrubbed).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      password: "[REDACTED]",
      api_key: "[REDACTED]",
      note: "call [REDACTED] to test",
    });
  });

  it("redacts long hex secrets in nested strings", () => {
    const scrubbed = redactPayload({
      msg: "leaked deadbeefdeadbeefdeadbeefdeadbeef but not short",
    });
    expect(scrubbed).toEqual({
      msg: "leaked [REDACTED] but not short",
    });
  });

  it("redacts recursively including arrays", () => {
    const scrubbed = redactPayload({
      items: [{ token: "abc" }, { safe: 1 }],
    });
    expect(scrubbed).toEqual({
      items: [{ token: "[REDACTED]" }, { safe: 1 }],
    });
  });

  it("passes null / undefined / primitives through untouched", () => {
    expect(redactPayload(null)).toBeNull();
    expect(redactPayload(undefined)).toBeUndefined();
    expect(redactPayload(42)).toBe(42);
    expect(redactPayload("plain string")).toBe("plain string");
  });

  it("redacts KTP-style keys nested inside employee objects", () => {
    const scrubbed = redactPayload({
      employee: {
        name: "Jane",
        ktp: "1234567890",
        bank_account_number: "1234567",
      },
    });
    expect(scrubbed).toEqual({
      employee: {
        name: "Jane",
        ktp: "[REDACTED]",
        bank_account_number: "[REDACTED]",
      },
    });
  });
});

describe("parseStackTrace", () => {
  it("extracts frames from a v8 stack trace and reverses order", () => {
    const stack = [
      "Error: boom",
      "    at inner (/app/src/inner.ts:12:34)",
      "    at outer (/app/src/outer.ts:5:6)",
    ].join("\n");
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    // Oldest first (outer) after reverse.
    expect(frames[0]?.filename).toBe("/app/src/outer.ts");
    expect(frames[0]?.function).toBe("outer");
    expect(frames[0]?.lineno).toBe(5);
    expect(frames[0]?.colno).toBe(6);
    expect(frames[1]?.function).toBe("inner");
  });

  it("returns empty array for garbage input", () => {
    expect(parseStackTrace("no frames here")).toEqual([]);
  });
});

describe("resolveSink()", () => {
  beforeEach(() => __resetSinkForTests());
  afterEach(() => __resetSinkForTests());

  it("returns NoOpSink when no env is set", () => {
    const sink = resolveSink({} as NodeJS.ProcessEnv);
    expect(sink).toBeInstanceOf(NoOpSink);
  });

  it("returns ConsoleSink when explicitly requested", () => {
    const sink = resolveSink({
      OBSERVABILITY_SINK: "console",
    } as unknown as NodeJS.ProcessEnv);
    expect(sink).toBeInstanceOf(ConsoleSink);
  });

  it("returns NoOpSink when OBSERVABILITY_SINK=off", () => {
    const sink = resolveSink({
      OBSERVABILITY_SINK: "off",
      SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
    } as unknown as NodeJS.ProcessEnv);
    expect(sink).toBeInstanceOf(NoOpSink);
  });

  it("auto-selects Sentry when DSN is set", () => {
    const sink = resolveSink({
      SENTRY_DSN: "https://pub@o0.ingest.sentry.io/12345",
    } as unknown as NodeJS.ProcessEnv);
    expect(sink).toBeInstanceOf(SentrySink);
  });

  it("auto-selects Axiom when token + dataset are set", () => {
    const sink = resolveSink({
      AXIOM_TOKEN: "xaat-x",
      AXIOM_DATASET: "controldesk",
    } as unknown as NodeJS.ProcessEnv);
    expect(sink).toBeInstanceOf(AxiomSink);
  });

  it("caches the sink across calls", () => {
    const first = resolveSink({
      OBSERVABILITY_SINK: "console",
    } as unknown as NodeJS.ProcessEnv);
    const second = resolveSink({} as NodeJS.ProcessEnv);
    expect(first).toBe(second);
  });
});

describe("__setSinkForTests", () => {
  afterEach(() => __resetSinkForTests());

  it("lets tests inject a mock sink for the duration of the run", async () => {
    const captured: SinkEvent[] = [];
    const mock: Sink = {
      name: "mock",
      capture: async (e) => void captured.push(e),
    };
    __setSinkForTests(mock);
    await resolveSink().capture(BASE_EVENT);
    expect(captured).toEqual([BASE_EVENT]);
  });
});

describe("SentrySink", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts an envelope with redacted payload + auth header", async () => {
    const seen: {
      url?: string;
      init?: RequestInit;
      body?: string;
    } = {};
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(url);
      seen.init = init;
      seen.body = init?.body as string;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const sink = new SentrySink({
      dsn: "https://mypub@o0.ingest.sentry.io/42",
      release: "v1.0.0",
      environment: "test",
    });

    await sink.capture({
      ...BASE_EVENT,
      request_id: "req-1",
      err: {
        name: "TypeError",
        message: "boom",
        stack: "TypeError: boom\n    at x (/app/x.ts:1:1)",
      },
      fields: { token: "leak-me-Bearer abcdefabcdefabcdefabcdef" },
    });

    expect(seen.url).toBe("https://o0.ingest.sentry.io/api/42/envelope/");
    expect(seen.init?.method).toBe("POST");
    const headers = new Headers(seen.init?.headers);
    expect(headers.get("content-type")).toBe("application/x-sentry-envelope");
    expect(headers.get("x-sentry-auth")).toMatch(/sentry_key=mypub/u);

    // Envelope is 3 newline-separated JSON lines.
    const [envelopeHeader, itemHeader, payload] = (seen.body ?? "").split("\n");
    expect(JSON.parse(envelopeHeader).event_id).toMatch(/^[0-9a-f]{32}$/u);
    expect(JSON.parse(itemHeader)).toEqual({ type: "event" });

    const p = JSON.parse(payload);
    expect(p.release).toBe("v1.0.0");
    expect(p.environment).toBe("test");
    // Redaction happened before dispatch.
    expect(p.extra.token).toBe("[REDACTED]");
    expect(p.exception.values[0].type).toBe("TypeError");
  });

  it("throws when DSN is malformed", () => {
    expect(() => new SentrySink({ dsn: "not-a-url" })).toThrow();
  });
});

describe("AxiomSink", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts a JSON array to the ingest endpoint with bearer token", async () => {
    const seen: {
      url?: string;
      init?: RequestInit;
      body?: string;
    } = {};
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(url);
      seen.init = init;
      seen.body = init?.body as string;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const sink = new AxiomSink({
      token: "xaat-abc",
      dataset: "controldesk-prod",
      environment: "prod",
    });
    await sink.capture({ ...BASE_EVENT, request_id: "req-2" });

    expect(seen.url).toBe(
      "https://api.axiom.co/v1/datasets/controldesk-prod/ingest",
    );
    const headers = new Headers(seen.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer xaat-abc");
    const arr = JSON.parse(seen.body ?? "[]");
    expect(arr).toHaveLength(1);
    expect(arr[0]).toMatchObject({
      level: "error",
      msg: "boom",
      request_id: "req-2",
      environment: "prod",
    });
  });
});

describe("NoOpSink", () => {
  it("resolves without side effects", async () => {
    const sink = new NoOpSink();
    await expect(sink.capture(BASE_EVENT)).resolves.toBeUndefined();
  });
});
