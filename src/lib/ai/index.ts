/**
 * ControlDesk AI Analytics Engine (rules §13).
 *
 * Prefer Vercel AI SDK's `generateObject()` with a Zod schema so every AI
 * response is validated + tenant-safe. NEVER pass another tenant's data
 * into a prompt (rules §3).
 *
 * Provider selection is intentionally left to the caller so the runtime
 * doesn't try to import a provider that isn't installed / configured. In a
 * follow-up you can:
 *
 *   pnpm add @ai-sdk/openai       # or @ai-sdk/anthropic / @ai-sdk/google
 *
 * and swap `resolveModel()` below to return the concrete provider instance.
 */

import { generateObject, type LanguageModel } from "ai";
import type { z } from "zod";

export type StructuredPromptOptions<TSchema extends z.ZodTypeAny> = {
  /** The Vercel AI SDK language model to invoke. */
  model: LanguageModel;
  /** Zod schema describing the required structured output. */
  schema: TSchema;
  /** System prompt — describe the AI's persona + rules. */
  system?: string;
  /** User prompt — the actual analytical question + tenant-scoped context. */
  prompt: string;
  /** Optional temperature, defaults to 0.2 for factual analytics. */
  temperature?: number;
};

export async function structured<TSchema extends z.ZodTypeAny>(
  opts: StructuredPromptOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const { object } = await generateObject({
    model: opts.model,
    schema: opts.schema,
    system: opts.system,
    prompt: opts.prompt,
    temperature: opts.temperature ?? 0.2,
  });
  return object as z.infer<TSchema>;
}

/**
 * Guardrail: prefix EVERY prompt with the tenant scope so a model that
 * inadvertently receives cross-tenant context refuses to synthesize.
 * Use `assertTenantScope` on the caller side to include the tenant slug in
 * every prompt string.
 */
export function assertTenantScope(prompt: string, tenantSlug: string): string {
  return [
    `Tenant scope: ${tenantSlug}. You MUST reason only about data within this tenant.`,
    `If asked about another tenant, refuse and explain the isolation rule.`,
    "",
    prompt,
  ].join("\n");
}
