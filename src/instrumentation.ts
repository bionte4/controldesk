/**
 * Next.js instrumentation entrypoint (rules §21).
 *
 * Called ONCE at server startup, before any request is served.
 * Runs in every runtime (Node.js, Edge, Turbopack dev) so
 * runtime-specific side effects MUST be gated behind `NEXT_RUNTIME`.
 *
 * Current responsibilities:
 *
 *   1. **Dev-only stdout / stderr redactor** — Next.js 16's
 *      Server Action dev logger dumps action args as JSON to
 *      stdout (`  └─ ƒ signInWithPassword({"email":..,"password":..})
 *      ...`). Since Next has no config knob to disable or redact
 *      that log, we wrap the write streams with a regex filter that
 *      strips values from `password` / `apiKey` / `secret` /
 *      `authorization` / etc. See `lib/observability/redact-stdout.ts`
 *      for the exhaustive key list and the "why we don't redact
 *      email" rationale.
 *
 * Anything added here should follow the same pattern: dynamic
 * import behind a runtime + env guard so we don't pull Node-only
 * code into the Edge bundle.
 */
export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV !== "production"
  ) {
    // Dynamic import so Turbopack's Edge bundle never sees this
    // Node-only side-effect module.
    const { installStdoutRedactor } = await import(
      "./lib/observability/redact-stdout"
    );
    installStdoutRedactor();
  }
}
