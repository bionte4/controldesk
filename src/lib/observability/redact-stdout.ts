/**
 * Defense-in-depth: transparent stdout / stderr redactor for dev.
 *
 * ## Why this file exists
 *
 * Next.js 16's Turbopack dev server automatically logs every Server
 * Action invocation with a shallow JSON dump of its arguments — the
 * `  └─ ƒ signInWithPassword({"email":"..","password":".."}) ...`
 * line under each `POST /login`. The formatter lives in
 * `next/dist/server/dev/server-action-logger.js` and there is NO
 * config knob to disable it or redact keys as of Next 16.3.
 *
 * That leak matters because:
 *   • Terminal panels in Cursor / VS Code retain scrollback.
 *   • Any shared dev container (Docker Compose, Codespaces) writes
 *     the same output to a file that other developers can read.
 *   • If a shell forwards its stdout to a log aggregator during
 *     `pnpm dev` (some team setups do), plaintext credentials land
 *     in that aggregator.
 *
 * We solve it by wrapping `process.stdout.write` and
 * `process.stderr.write` with a filter that scrubs known
 * credential-shaped JSON key-value pairs before they hit the
 * terminal. The wrapper is installed exactly once, at Node server
 * startup, from `src/instrumentation.ts`.
 *
 * ## Scope
 *
 * Only active in NON-production runtimes. Production doesn't emit
 * Server Action arg logs (that's a `next/dist/server/dev/` code
 * path), and our own application logger (`src/lib/observability/
 * log.ts`) never puts credential-shaped fields on the wire — its
 * callers pass structured metadata, not full request bodies. So the
 * production-path stdout stays untouched, and the regex tax stays
 * off the hot path where every request writes a JSON access line.
 *
 * ## Removal path
 *
 * When Next.js ships a config for arg redaction / disable
 * (`experimental.logging.serverActions.redactKeys` or similar),
 * switch to that and delete this module + `src/instrumentation.ts`
 * if no other instrumentation lives there.
 */

/**
 * JSON key-value pairs that should never appear in dev logs. The
 * regex matches the double-quoted key + colon (+ optional whitespace)
 * + a double-quoted value, then replaces the value with the redacted
 * placeholder while keeping the key intact so the surrounding shape
 * is preserved (still parseable, still shows WHICH field was
 * censored). Case-insensitive so `Password` / `PASSWORD` / `password`
 * all match.
 *
 * Deliberately NOT matching a bare `email` — emails are commonly
 * needed for debugging auth flows and are already visible in the
 * `POST /login` request row above the redacted line, so the leak
 * story doesn't get any worse by keeping them readable.
 */
const SENSITIVE_JSON_KEY_PATTERN =
  /("(?:password|passwd|pwd|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|client[_-]?secret|service[_-]?role[_-]?key|encryption[_-]?key)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

/**
 * Bearer / API-key headers sometimes appear in raw request dumps
 * during dev. Match `authorization: Bearer <token>` and similar,
 * both header-shaped and JSON-shaped forms already covered above.
 */
const BEARER_HEADER_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/g;

const REDACTED_VALUE = '"[REDACTED]"';
const REDACTED_BEARER = "Bearer [REDACTED]";

let installed = false;

/**
 * Wrap `process.stdout.write` and `process.stderr.write` with a
 * regex filter. Idempotent — safe to call from HMR-friendly code
 * paths.
 */
export function installStdoutRedactor(): void {
  if (installed) return;
  installed = true;

  patchStream(process.stdout);
  patchStream(process.stderr);
}

/**
 * Replace `stream.write` with a wrapper that redacts sensitive
 * strings before delegating to the original.
 *
 * `write` supports three overload shapes:
 *   1. `write(chunk)`
 *   2. `write(chunk, callback)`
 *   3. `write(chunk, encoding, callback)`
 *
 * We forward all three. Non-string chunks (Buffer / Uint8Array) are
 * passed through untouched — the target log lines are always
 * generated as strings via template literals in Next's logger, so
 * covering only the string path is sufficient AND avoids the cost
 * of decoding every binary stdout write.
 */
function patchStream(
  stream: NodeJS.WriteStream & { _redactorInstalled?: boolean },
): void {
  if (stream._redactorInstalled) return;
  stream._redactorInstalled = true;

  const originalWrite = stream.write.bind(stream);
  // We narrow the signature via a permissive wrapper — Node's own
  // typings for `.write` are already a union with `unknown`-ish
  // callback shapes.
  type WriteFn = typeof stream.write;
  const wrapped: WriteFn = ((
    chunk: unknown,
    encodingOrCb?: unknown,
    cb?: unknown,
  ): boolean => {
    let redacted: unknown = chunk;
    if (typeof chunk === "string") {
      redacted = redactLine(chunk);
    }
    // TS can't statically narrow the overload here; the runtime
    // shape matches whichever the caller chose.
    return (
      originalWrite as unknown as (
        c: unknown,
        e?: unknown,
        c2?: unknown,
      ) => boolean
    )(redacted, encodingOrCb, cb);
  }) as WriteFn;

  stream.write = wrapped;
}

/**
 * Exported for unit tests — the regex substitution alone, no I/O.
 * Idempotent + linear-time (no catastrophic backtracking) so calling
 * it on every stdout write is cheap even at high log volumes.
 */
export function redactLine(line: string): string {
  let out = line.replace(SENSITIVE_JSON_KEY_PATTERN, `$1${REDACTED_VALUE}`);
  out = out.replace(BEARER_HEADER_PATTERN, REDACTED_BEARER);
  return out;
}
