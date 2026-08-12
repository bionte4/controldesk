import "server-only";

import { generateText } from "ai";

import { log } from "@/lib/observability/log";

import type { AiProvider } from "./repository";

/**
 * Verify AI provider credentials by making a real "hello world" call.
 *
 * Called by the tenant AI admin form BEFORE persisting the row so a
 * bad API key or wrong `base_url` surfaces at save time rather than
 * during the next insight run. The prompt is intentionally trivial
 * ("Respond with the single word: pong.") to keep the verification
 * cheap on token budgets and low-latency on cold GPUs.
 *
 * Providers are dynamically imported so this module doesn't require
 * all SDKs to be installed. Consistent with the resolver + mailer
 * patterns.
 */
export async function verifyAiCredentials(input: {
  provider: AiProvider;
  modelId: string;
  apiKey: string | null;
  baseUrl: string | null;
}): Promise<
  | { ok: true; response: string }
  | { ok: false; error: string }
> {
  if (input.provider === "DISABLED") {
    // Nothing to verify — the DISABLED provider is a signal to the
    // resolver, not a real endpoint.
    return { ok: true, response: "disabled" };
  }

  try {
    const dyn = new Function(
      "spec",
      "return import(spec);",
    ) as (spec: string) => Promise<unknown>;

    let model: unknown = null;

    if (input.provider === "GOOGLE") {
      // Direct `await import(...)` (not the `new Function` bypass used for
      // the optional openai/anthropic branches below) so Next.js's file
      // tracer follows the import chain and copies `@ai-sdk/google` +
      // its transitive `@ai-sdk/provider-utils` / `@ai-sdk/provider` deps
      // into `.next/standalone/node_modules/`. Without this, the prod
      // Docker `runner` stage boots without the SDK and every verify
      // call fails with "SDK not installed on the server." (This is
      // safe here because `@ai-sdk/google` is a first-party dependency
      // in package.json — resolve-at-build-time is guaranteed.)
      const mod = (await import("@ai-sdk/google").catch(() => null)) as
        | { google: (id: string) => unknown; createGoogleGenerativeAI?: (o: { apiKey: string }) => (id: string) => unknown }
        | null;
      if (!mod) {
        return {
          ok: false,
          error:
            "Google AI SDK (`@ai-sdk/google`) is not installed on the server.",
        };
      }
      if (input.apiKey && mod.createGoogleGenerativeAI) {
        model = mod.createGoogleGenerativeAI({ apiKey: input.apiKey })(
          input.modelId,
        );
      } else {
        model = mod.google(input.modelId);
      }
    }

    if (input.provider === "OPENAI") {
      const mod = (await dyn("@ai-sdk/openai").catch(() => null)) as
        | { openai: (id: string) => unknown; createOpenAI?: (o: { apiKey: string }) => (id: string) => unknown }
        | null;
      if (!mod) {
        return {
          ok: false,
          error: "OpenAI SDK (`@ai-sdk/openai`) is not installed on the server.",
        };
      }
      if (input.apiKey && mod.createOpenAI) {
        model = mod.createOpenAI({ apiKey: input.apiKey })(input.modelId);
      } else {
        model = mod.openai(input.modelId);
      }
    }

    if (input.provider === "ANTHROPIC") {
      const mod = (await dyn("@ai-sdk/anthropic").catch(() => null)) as
        | { anthropic: (id: string) => unknown; createAnthropic?: (o: { apiKey: string }) => (id: string) => unknown }
        | null;
      if (!mod) {
        return {
          ok: false,
          error: "Anthropic SDK (`@ai-sdk/anthropic`) is not installed on the server.",
        };
      }
      if (input.apiKey && mod.createAnthropic) {
        model = mod.createAnthropic({ apiKey: input.apiKey })(input.modelId);
      } else {
        model = mod.anthropic(input.modelId);
      }
    }

    if (input.provider === "OPENAI_COMPATIBLE") {
      if (!input.baseUrl) {
        return {
          ok: false,
          error: "Base URL is required for OPENAI_COMPATIBLE providers.",
        };
      }
      const mod = (await dyn("@ai-sdk/openai").catch(() => null)) as
        | { createOpenAI?: (o: { apiKey: string; baseURL: string }) => (id: string) => unknown }
        | null;
      if (!mod?.createOpenAI) {
        return {
          ok: false,
          error: "OpenAI SDK (`@ai-sdk/openai`) is not installed on the server.",
        };
      }
      model = mod.createOpenAI({
        apiKey: input.apiKey ?? "not-needed",
        baseURL: input.baseUrl,
      })(input.modelId);
    }

    if (!model) {
      return {
        ok: false,
        error: `Provider "${input.provider}" is not supported.`,
      };
    }

    // Use a direct static import of `generateText` (not the `new Function`
    // bypass) so Next.js's file tracer picks up the `ai` package into
    // `.next/standalone/node_modules/`. Same reason we do the direct
    // import for `@ai-sdk/google` above.
    //
    // Hard-cap the wait — remote LLMs can be slow to warm up on cold
    // GPUs. 15s is generous but bounded.
    const timeoutMs = 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await generateText({
        // The AI SDK's `LanguageModel` type is a discriminated union of
        // provider-specific handles; each branch of the block above
        // returns one of those. We erase the type here because upstream
        // dynamic-import shims give us `unknown`.
        model: model as Parameters<typeof generateText>[0]["model"],
        prompt: "Respond with the single word: pong.",
        abortSignal: controller.signal,
      });
      return { ok: true, response: (result.text ?? "").trim().slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.info("ai: verify failed", { provider: input.provider, error });
    return { ok: false, error };
  }
}
