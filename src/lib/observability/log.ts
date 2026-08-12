import "server-only";

import { resolveSink, type SinkEvent } from "./sink";

/**
 * ControlDesk — structured JSON logger (rules §21).
 *
 * Produksi mengeluarkan satu baris JSON per event yang bisa dikonsumsi
 * langsung oleh Datadog / Axiom / Loki. Development mengeluarkan format
 * yang lebih ramah manusia via `console.debug/info/warn/error`.
 *
 * Untuk `warn` dan `error`, log helper juga fire-and-forget dispatch
 * event ke observability sink yang aktif (Sentry / Axiom / NoOp). Sink
 * dipilih otomatis berdasarkan env var (lihat `resolveSink()`).
 *
 * Konvensi field:
 *   `ts`         — ISO timestamp (UTC).
 *   `level`      — 'debug' | 'info' | 'warn' | 'error'.
 *   `msg`        — pesan singkat human-readable.
 *   `tenant_id`  — bila tersedia.
 *   `user_id`    — bila tersedia.
 *   `request_id` — dari `x-request-id` header bila ada.
 *   `err`        — { name, message, stack } bila error dilewatkan.
 *
 * Wajib digunakan sebagai pengganti `console.log` di seluruh production path.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentMinLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
  return LEVEL_ORDER[env] !== undefined ? env : "info";
}

export type LogFields = {
  tenant_id?: string | null;
  user_id?: string | null;
  request_id?: string | null;
  [key: string]: unknown;
};

type LogPayload = LogFields & {
  ts: string;
  level: LogLevel;
  msg: string;
  err?: { name: string; message: string; stack?: string };
};

function serializeError(err: unknown): LogPayload["err"] {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
    };
  }
  if (typeof err === "object" && err !== null) {
    return { name: "UnknownError", message: JSON.stringify(err) };
  }
  return { name: "UnknownError", message: String(err) };
}

function emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentMinLevel()]) return;

  const { err, ...rest } = fields as LogFields & { err?: unknown };
  const payload: LogPayload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...rest,
  };
  if (err !== undefined) payload.err = serializeError(err);

  const line = JSON.stringify(payload);
  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }

  if (level === "warn" || level === "error") {
    dispatchToSink(payload);
  }
}

/**
 * Fire-and-forget dispatch to the configured observability sink. Any
 * failure is swallowed inside the sink implementation.
 */
function dispatchToSink(payload: LogPayload): void {
  const {
    ts,
    level,
    msg,
    err,
    tenant_id,
    user_id,
    request_id,
    source,
    route,
    user_agent,
    ...rest
  } = payload as LogPayload & {
    source?: SinkEvent["source"];
    route?: string;
    user_agent?: string;
  };

  const event: SinkEvent = {
    ts,
    level: level === "warn" ? "warn" : "error",
    msg,
    err,
    tenant_id: typeof tenant_id === "string" ? tenant_id : undefined,
    user_id: typeof user_id === "string" ? user_id : undefined,
    request_id: typeof request_id === "string" ? request_id : undefined,
    source,
    route,
    user_agent,
    fields: Object.keys(rest).length ? (rest as Record<string, unknown>) : undefined,
  };

  try {
    // No `await` — dispatch runs in background. sink.capture() catches its
    // own errors so the promise cannot reject observably here.
    void resolveSink().capture(event);
  } catch {
    // Selector itself blew up — swallow. The console line above still lands.
  }
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),

  /**
   * Return a child logger that always includes the given fields. Useful for
   * per-request or per-module scoping.
   */
  with(context: LogFields) {
    return {
      debug: (msg: string, fields?: LogFields) =>
        emit("debug", msg, { ...context, ...fields }),
      info: (msg: string, fields?: LogFields) =>
        emit("info", msg, { ...context, ...fields }),
      warn: (msg: string, fields?: LogFields) =>
        emit("warn", msg, { ...context, ...fields }),
      error: (msg: string, fields?: LogFields) =>
        emit("error", msg, { ...context, ...fields }),
    };
  },
};
