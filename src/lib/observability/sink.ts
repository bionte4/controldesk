/**
 * ControlDesk — observability sink (rules §21).
 *
 * A dependency-free sink abstraction that forwards `warn` + `error` events
 * to an external observability provider. The default install is `noop`
 * so unit tests never touch the network. Production picks a sink based on
 * env vars — Sentry (via DSN + envelope API) or Axiom (via ingest API).
 *
 * Design notes:
 *   • Kept pure-fetch on purpose. The Sentry Next.js SDK requires webpack
 *     plugins + source-map upload that adds significant build complexity;
 *     for our use-case (server + client error breadcrumbs) the raw envelope
 *     API is sufficient and much easier to redact.
 *   • All PII redaction WAJIB happen before sink dispatch. Callers pass
 *     already-scrubbed events; the sink does one more redaction pass on
 *     obvious fields (auth headers, cookies) as a defensive net.
 *   • Every dispatch is fire-and-forget with a short timeout. Never block
 *     the request path — logging failure is silent by design.
 */

export type SinkEventLevel = "warn" | "error" | "fatal";

export type SinkEvent = {
  level: SinkEventLevel;
  msg: string;
  ts: string;
  release?: string;
  environment?: string;
  request_id?: string;
  tenant_id?: string;
  user_id?: string;
  err?: { name: string; message: string; stack?: string };
  fields?: Record<string, unknown>;
  source?: "server" | "client" | "cron";
  route?: string;
  user_agent?: string;
};

export interface Sink {
  readonly name: string;
  capture(event: SinkEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Redaction helpers.
// ---------------------------------------------------------------------------

const REDACT_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /bearer/i,
  /credit[_-]?card/i,
  /ktp/i,
  /npwp/i,
  /bank[_-]?account/i,
];

const REDACT_VALUE_PATTERNS: RegExp[] = [
  // Bearer / API tokens.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g,
  // Long hex / base64 secrets.
  /\b[A-Fa-f0-9]{32,}\b/g,
];

function redactString(input: string): string {
  let out = input;
  for (const pattern of REDACT_VALUE_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function redactPayload<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactPayload(v)) as unknown as T;
  }
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEY_PATTERNS.some((rx) => rx.test(k))) {
      obj[k] = "[REDACTED]";
    } else {
      obj[k] = redactPayload(v);
    }
  }
  return obj as unknown as T;
}

// ---------------------------------------------------------------------------
// Adapters.
// ---------------------------------------------------------------------------

export class NoOpSink implements Sink {
  readonly name = "noop";
  async capture(_event: SinkEvent): Promise<void> {
    /* intentionally blank */
  }
}

export class ConsoleSink implements Sink {
  readonly name = "console";
  async capture(event: SinkEvent): Promise<void> {
    // Compact JSON to stderr so log collectors already tailing stdout/stderr
    // pick this up alongside `log.ts` output.
    const line = JSON.stringify({ sink: "console", ...redactPayload(event) });
    if (event.level === "warn") console.warn(line);
    else console.error(line);
  }
}

/**
 * SentrySink — POSTs a single-event envelope to the store endpoint derived
 * from the DSN. Docs: https://develop.sentry.dev/sdk/envelopes/.
 */
export class SentrySink implements Sink {
  readonly name = "sentry";
  private readonly ingestUrl: string;
  private readonly publicKey: string;
  private readonly release?: string;
  private readonly environment?: string;

  constructor(config: {
    dsn: string;
    release?: string;
    environment?: string;
  }) {
    const parsed = parseSentryDsn(config.dsn);
    this.ingestUrl = parsed.storeUrl;
    this.publicKey = parsed.publicKey;
    this.release = config.release;
    this.environment = config.environment;
  }

  async capture(event: SinkEvent): Promise<void> {
    const scrubbed = redactPayload(event);
    const eventId = randomHex32();
    const timestamp = Math.floor(Date.parse(event.ts) / 1000);
    const payload = {
      event_id: eventId,
      timestamp,
      level: scrubbed.level === "fatal" ? "fatal" : scrubbed.level,
      release: this.release ?? scrubbed.release,
      environment: this.environment ?? scrubbed.environment,
      message: { formatted: scrubbed.msg },
      request: scrubbed.route
        ? {
            url: scrubbed.route,
            headers: scrubbed.user_agent
              ? { "user-agent": scrubbed.user_agent }
              : undefined,
          }
        : undefined,
      tags: {
        request_id: scrubbed.request_id,
        tenant_id: scrubbed.tenant_id,
        source: scrubbed.source,
      },
      user: scrubbed.user_id ? { id: scrubbed.user_id } : undefined,
      extra: scrubbed.fields,
      exception: scrubbed.err
        ? {
            values: [
              {
                type: scrubbed.err.name,
                value: scrubbed.err.message,
                stacktrace: scrubbed.err.stack
                  ? {
                      frames: parseStackTrace(scrubbed.err.stack),
                    }
                  : undefined,
              },
            ],
          }
        : undefined,
    };

    const envelope = [
      JSON.stringify({
        event_id: eventId,
        sent_at: new Date().toISOString(),
      }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(payload),
    ].join("\n");

    await fetchWithTimeout(this.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": buildSentryAuthHeader(this.publicKey),
      },
      body: envelope,
    });
  }
}

/**
 * AxiomSink — HTTPS ingest to a dataset with a bearer token.
 * Docs: https://axiom.co/docs/send-data/ingest#send-data-via-api.
 */
export class AxiomSink implements Sink {
  readonly name = "axiom";
  private readonly dataset: string;
  private readonly token: string;
  private readonly release?: string;
  private readonly environment?: string;

  constructor(config: {
    dataset: string;
    token: string;
    release?: string;
    environment?: string;
  }) {
    this.dataset = config.dataset;
    this.token = config.token;
    this.release = config.release;
    this.environment = config.environment;
  }

  async capture(event: SinkEvent): Promise<void> {
    const scrubbed = redactPayload(event);
    const body = JSON.stringify([
      {
        _time: scrubbed.ts,
        level: scrubbed.level,
        msg: scrubbed.msg,
        release: this.release ?? scrubbed.release,
        environment: this.environment ?? scrubbed.environment,
        request_id: scrubbed.request_id,
        tenant_id: scrubbed.tenant_id,
        user_id: scrubbed.user_id,
        source: scrubbed.source,
        route: scrubbed.route,
        user_agent: scrubbed.user_agent,
        err: scrubbed.err,
        fields: scrubbed.fields,
      },
    ]);

    await fetchWithTimeout(
      `https://api.axiom.co/v1/datasets/${encodeURIComponent(this.dataset)}/ingest`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Selector.
// ---------------------------------------------------------------------------

let cachedSink: Sink | null = null;

export function resolveSink(env: NodeJS.ProcessEnv = process.env): Sink {
  if (cachedSink) return cachedSink;

  const forced = env.OBSERVABILITY_SINK?.toLowerCase();
  const release =
    env.RELEASE_TAG ?? env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_SHA ?? undefined;
  const environment = env.OBSERVABILITY_ENV ?? env.NODE_ENV ?? undefined;

  if (forced === "noop" || forced === "off") {
    cachedSink = new NoOpSink();
    return cachedSink;
  }
  if (forced === "console") {
    cachedSink = new ConsoleSink();
    return cachedSink;
  }

  if ((forced === "sentry" || (!forced && env.SENTRY_DSN)) && env.SENTRY_DSN) {
    cachedSink = new SentrySink({
      dsn: env.SENTRY_DSN,
      release,
      environment,
    });
    return cachedSink;
  }

  if (
    (forced === "axiom" ||
      (!forced && env.AXIOM_TOKEN && env.AXIOM_DATASET)) &&
    env.AXIOM_TOKEN &&
    env.AXIOM_DATASET
  ) {
    cachedSink = new AxiomSink({
      dataset: env.AXIOM_DATASET,
      token: env.AXIOM_TOKEN,
      release,
      environment,
    });
    return cachedSink;
  }

  cachedSink = new NoOpSink();
  return cachedSink;
}

/** Test helper — never call from production paths. */
export function __resetSinkForTests(): void {
  cachedSink = null;
}

/** Test helper — inject a mock sink. */
export function __setSinkForTests(sink: Sink): void {
  cachedSink = sink;
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 1_500,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { ...init, signal: controller.signal, keepalive: true });
  } catch {
    // Silent — the sink must never crash the caller.
  } finally {
    clearTimeout(timer);
  }
}

function parseSentryDsn(dsn: string): {
  storeUrl: string;
  publicKey: string;
} {
  const url = new URL(dsn);
  const publicKey = url.username;
  const projectId = url.pathname.replace(/^\//u, "");
  if (!publicKey || !projectId) {
    throw new Error("Invalid SENTRY_DSN: missing key or project id");
  }
  const host = url.host;
  const scheme = url.protocol.replace(":", "");
  return {
    storeUrl: `${scheme}://${host}/api/${projectId}/envelope/`,
    publicKey,
  };
}

function buildSentryAuthHeader(publicKey: string): string {
  return [
    "Sentry sentry_version=7",
    "sentry_client=controldesk/1.0",
    `sentry_key=${publicKey}`,
  ].join(", ");
}

function randomHex32(): string {
  // 128 bits, dash-free — Sentry rejects UUID dashes.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Best-effort JS stack-trace → Sentry frame array parser. We only need a
 * short subset (filename + function + lineno + colno) and Sentry tolerates
 * missing fields gracefully.
 */
export function parseStackTrace(stack: string): Array<{
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
}> {
  const frames: Array<{
    filename?: string;
    function?: string;
    lineno?: number;
    colno?: number;
  }> = [];
  const lines = stack.split("\n").slice(1); // drop the error message line
  const re =
    /at\s+(?:(?<fn>[^\s(]+)\s+\()?(?<file>[^\s():]+):(?<line>\d+):(?<col>\d+)\)?/u;
  for (const line of lines) {
    const m = re.exec(line);
    if (!m || !m.groups) continue;
    frames.push({
      function: m.groups.fn,
      filename: m.groups.file,
      lineno: Number.parseInt(m.groups.line, 10),
      colno: Number.parseInt(m.groups.col, 10),
    });
  }
  // Sentry expects oldest → newest, but Error.stack is newest → oldest.
  return frames.reverse();
}
