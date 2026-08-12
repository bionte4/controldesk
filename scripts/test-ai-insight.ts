/**
 * Smoke test for the AI Analytics Engine (rules §15).
 *
 * What it does:
 *   1. Reads AI_PROVIDER / AI_MODEL_ID / API key from environment.
 *   2. Fires a tiny `generateObject()` call with a Zod schema.
 *   3. Prints the parsed object + token usage + latency.
 *
 * Usage:
 *   pnpm test:ai                                # default: English sanity check
 *   pnpm test:ai --locale=id                    # force Bahasa Indonesia
 *   pnpm test:ai --locale=en "Custom prompt"    # English + custom prompt
 *
 * If AI_PROVIDER=mock (or provider package/key missing) the script exits
 * with a clear message pointing at .env.local. This mirrors the mock/live
 * decision inside `src/lib/ai/generators.ts` so a green test:ai run means
 * the /insights page will produce real narrative output too.
 */

import { generateObject } from "ai";
import { z } from "zod";

type ProviderName = "openai" | "anthropic" | "google" | "mock";

function providerName(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  if (raw === "openai" || raw === "anthropic" || raw === "google") return raw;
  return "mock";
}

function modelId(): string {
  return (
    process.env.AI_MODEL_ID ??
    (providerName() === "google"
      ? "gemini-2.5-flash"
      : providerName() === "openai"
        ? "gpt-4o-mini"
        : providerName() === "anthropic"
          ? "claude-3-5-haiku-latest"
          : "mock")
  );
}

async function resolveModel(): Promise<unknown> {
  const name = providerName();
  if (name === "mock") return null;
  const dynImport: (spec: string) => Promise<unknown> = new Function(
    "spec",
    "return import(spec);",
  ) as (spec: string) => Promise<unknown>;
  if (name === "openai") {
    const mod = (await dynImport("@ai-sdk/openai").catch(() => null)) as
      | { openai: (id: string) => unknown }
      | null;
    return mod?.openai(modelId()) ?? null;
  }
  if (name === "anthropic") {
    const mod = (await dynImport("@ai-sdk/anthropic").catch(() => null)) as
      | { anthropic: (id: string) => unknown }
      | null;
    return mod?.anthropic(modelId()) ?? null;
  }
  if (name === "google") {
    const mod = (await dynImport("@ai-sdk/google").catch(() => null)) as
      | { google: (id: string) => unknown }
      | null;
    return mod?.google(modelId()) ?? null;
  }
  return null;
}

async function main() {
  const provider = providerName();
  const model_id = modelId();

  // Extract --locale=xx from argv; remaining positional args form the prompt.
  const argv = process.argv.slice(2);
  const positional: string[] = [];
  let locale: "id" | "en" = "en";
  for (const raw of argv) {
    if (raw.startsWith("--locale=")) {
      const v = raw.slice("--locale=".length).toLowerCase();
      locale = v === "id" ? "id" : "en";
    } else {
      positional.push(raw);
    }
  }

  const defaultPrompts = {
    id: "Beri snapshot 3-poin kesehatan tenant BPO demo: satu kekuatan, satu risiko, satu aksi rekomendasi. Setiap poin maksimum 20 kata.",
    en: "Give a 3-item health snapshot for a demo BPO tenant: one strength, one risk, one recommended action. Keep each item under 20 words.",
  };
  const prompt = positional.join(" ") || defaultPrompts[locale];
  const systemDirective =
    locale === "id"
      ? "Anda seorang analis ERP. Balas HANYA dengan objek terstruktur yang diminta dalam Bahasa Indonesia formal. Ringkas."
      : "You are an ERP analyst. Reply only with the requested structured object in professional English. Be concise.";

  console.log("=".repeat(64));
  console.log("ControlDesk AI smoke test");
  console.log("=".repeat(64));
  console.log(`provider  : ${provider}`);
  console.log(`model_id  : ${model_id}`);
  console.log(`locale    : ${locale}`);
  console.log(`prompt    : ${prompt}`);
  console.log("");

  if (provider === "mock") {
    console.error(
      "AI_PROVIDER=mock — nothing to hit. Set AI_PROVIDER + API key in .env.local first.",
    );
    process.exit(2);
  }

  const keyEnv =
    provider === "openai"
      ? "OPENAI_API_KEY"
      : provider === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : "GOOGLE_GENERATIVE_AI_API_KEY";
  const keyVal = process.env[keyEnv] ?? "";
  if (!keyVal || keyVal.startsWith("PASTE_")) {
    console.error(`${keyEnv} not set (or still the placeholder) in .env.local.`);
    console.error(
      provider === "google"
        ? "Grab a free key at https://aistudio.google.com/apikey"
        : provider === "openai"
          ? "Grab a key at https://platform.openai.com/api-keys"
          : "Grab a key at https://console.anthropic.com/settings/keys",
    );
    process.exit(2);
  }

  const model = await resolveModel();
  if (!model) {
    console.error(
      `Provider package @ai-sdk/${provider} not installed. Run: pnpm add @ai-sdk/${provider}`,
    );
    process.exit(2);
  }

  const schema = z.object({
    strength: z.string().min(3).describe("One positive observation about the tenant."),
    risk: z.string().min(3).describe("One risk that needs attention."),
    action: z
      .string()
      .min(3)
      .describe("One concrete next action, time-bound if possible."),
  });

  console.log("Calling model…");
  const started = Date.now();
  const genObj = generateObject as unknown as (opts: {
    model: unknown;
    schema: unknown;
    system?: string;
    prompt: string;
    temperature?: number;
  }) => Promise<{
    object: unknown;
    usage?: { inputTokens?: number; outputTokens?: number };
  }>;

  try {
    const { object, usage } = await genObj({
      model,
      schema,
      system: systemDirective,
      prompt,
      temperature: 0.2,
    });
    const latency_ms = Date.now() - started;

    console.log("");
    console.log("Result:");
    console.log(JSON.stringify(object, null, 2));
    console.log("");
    console.log(`tokens in : ${usage?.inputTokens ?? "?"}`);
    console.log(`tokens out: ${usage?.outputTokens ?? "?"}`);
    console.log(`latency   : ${latency_ms}ms`);
    console.log("");
    console.log(
      "SUKSES — AI Insights sekarang bisa dijalankan live di /insights.",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("");
    console.error("GAGAL:");
    console.error(msg);
    console.error("");
    if (msg.toLowerCase().includes("api key") || msg.includes("401")) {
      console.error("  → API key salah atau tidak valid. Cek di .env.local.");
    } else if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
      console.error("  → Rate limit hit. Free tier: 10 req/min. Tunggu 60 detik.");
    } else if (msg.toLowerCase().includes("model")) {
      console.error(
        `  → Model \`${model_id}\` mungkin tidak tersedia. Coba gemini-2.0-flash atau gemini-1.5-flash.`,
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
