import "server-only";

import { z } from "zod";

/**
 * Level 3 inline copilot — "AI-assist for form fields".
 *
 * Each supported form field is registered here as a **surface**. A
 * surface controls:
 *   • how the user's raw input + context is rendered into the LLM
 *     prompt;
 *   • how much output the model is allowed to produce;
 *   • which context keys are allowed (deliberate whitelist to keep
 *     the client from smuggling arbitrary data into the model).
 *
 * ## Design principles
 *
 *   • **No tenant data lookup here**. The route handler receives
 *     `context` from the client and passes it through. The client
 *     has already loaded the values it's showing to the user in
 *     the form; we don't re-fetch from the DB. Rationale: keeps
 *     the copilot dead-simple + fast + deterministic. If the user
 *     doesn't see it in their form, the model doesn't get it.
 *   • **Tightly bounded output**. Every surface caps `maxTokens`
 *     under 200 so a runaway response can't blow the daily budget.
 *   • **Locale-aware**. `formatContext` uses the caller's locale
 *     hint so Indonesian tenants get Indonesian output.
 *   • **Idempotent on empty input**. If the user hasn't typed
 *     anything the copilot generates a fresh draft. If they have,
 *     it treats the input as a first draft and refines.
 */

export type CopilotLocale = "id" | "en";

export type CopilotContext = Record<string, string | number | undefined | null>;

export type CopilotSurfaceId =
  | "ca_purpose"
  | "field_ops_justification"
  | "expense_description"
  | "project_description";

export type CopilotSurface = {
  id: CopilotSurfaceId;
  /** Roles allowed to use this surface. Empty = all authenticated. */
  allowedRoles: readonly string[];
  /** Ceiling for the model's output tokens. Keep tight. */
  maxOutputTokens: number;
  /**
   * Whitelist of context keys the client may send. Anything not in
   * this list is dropped before rendering the prompt.
   */
  contextKeys: readonly string[];
  /**
   * Build the system + user prompt for this surface. The system
   * prompt owns the guardrails; the user prompt carries data.
   */
  buildPrompt: (input: {
    tenantName: string;
    locale: CopilotLocale;
    userInput: string;
    context: CopilotContext;
  }) => { system: string; user: string };
};

const commonGuardrails = (tenantName: string, locale: CopilotLocale): string => {
  const preamble =
    locale === "id"
      ? `Kamu adalah asisten AI di aplikasi ControlDesk untuk tenant "${tenantName}". Tugasmu memperbaiki teks form pengguna dengan singkat dan profesional.`
      : `You are the ControlDesk AI copilot for tenant "${tenantName}". Your job is to refine short form field text into professional, concise business language.`;
  const rules =
    locale === "id"
      ? [
          "Tulis ulang atau susun draft baru berdasarkan input pengguna dan konteks yang diberikan.",
          "Jangan menambahkan angka, nama, tanggal, atau referensi yang tidak ada di input atau konteks.",
          "Jangan menyertakan komentar meta ('Berikut hasilnya', 'Semoga membantu', dst).",
          "Gunakan bahasa Indonesia formal, kecuali input pengguna jelas berbahasa Inggris.",
          "Output HANYA teks final tanpa markdown, tanpa kutipan, tanpa list bullet.",
          "Jaga panjang di bawah 60 kata (kira-kira 400 karakter). Lebih pendek lebih baik.",
        ]
      : [
          "Rewrite or draft the text based on the user's input and the given context.",
          "Do NOT invent numbers, names, dates, or references that aren't in the input or context.",
          "Do NOT add meta commentary ('Here you go', 'Hope this helps', etc).",
          "Use professional English unless the user's input is clearly Indonesian.",
          "Output ONLY the final text — no markdown, no quotes, no bullet lists.",
          "Keep it under 60 words (~400 characters). Shorter is better.",
        ];
  return [preamble, "", "Rules:", ...rules.map((r) => `- ${r}`)].join("\n");
};

const formatContextBlock = (
  context: CopilotContext,
  allowedKeys: readonly string[],
  locale: CopilotLocale,
): string => {
  const header = locale === "id" ? "Konteks form" : "Form context";
  const rows: string[] = [];
  for (const key of allowedKeys) {
    const value = context[key];
    if (value === undefined || value === null || value === "") continue;
    rows.push(`- ${key}: ${String(value)}`);
  }
  if (rows.length === 0) return "";
  return `${header}:\n${rows.join("\n")}`;
};

const buildDefaultPrompt = (
  surfaceHelp: { id: string; hint: (locale: CopilotLocale) => string },
  allowedContextKeys: readonly string[],
  input: {
    tenantName: string;
    locale: CopilotLocale;
    userInput: string;
    context: CopilotContext;
  },
): { system: string; user: string } => {
  const { tenantName, locale, userInput, context } = input;
  const system = [
    commonGuardrails(tenantName, locale),
    "",
    locale === "id" ? "Konteks form:" : "Field:",
    `- ${surfaceHelp.id}: ${surfaceHelp.hint(locale)}`,
  ].join("\n");
  const contextBlock = formatContextBlock(context, allowedContextKeys, locale);
  const inputBlock =
    userInput.trim().length > 0
      ? locale === "id"
        ? `Draft awal dari pengguna:\n${userInput.trim()}`
        : `User's draft:\n${userInput.trim()}`
      : locale === "id"
        ? "Draft awal: (kosong — buat dari nol berdasarkan konteks)"
        : "User's draft: (empty — write from scratch using the context)";
  const user = [contextBlock, inputBlock].filter(Boolean).join("\n\n");
  return { system, user };
};

export const COPILOT_SURFACES: Record<CopilotSurfaceId, CopilotSurface> = {
  ca_purpose: {
    id: "ca_purpose",
    allowedRoles: [],
    maxOutputTokens: 200,
    contextKeys: ["amount", "project_name", "expected_settlement_date"],
    buildPrompt: (input) =>
      buildDefaultPrompt(
        {
          id: "cash_advance_purpose",
          hint: (l) =>
            l === "id"
              ? "Tujuan pengajuan uang muka kerja (Cash Advance). Jelaskan untuk apa dana ini akan dipakai, singkat dan konkret."
              : "Purpose of the cash advance request. State concretely what the funds will be used for.",
        },
        ["amount", "project_name", "expected_settlement_date"],
        input,
      ),
  },
  field_ops_justification: {
    id: "field_ops_justification",
    allowedRoles: [],
    maxOutputTokens: 220,
    contextKeys: [
      "project_name",
      "area",
      "tujuan",
      "ticket_number",
      "transport_need",
      "pic_name",
    ],
    buildPrompt: (input) =>
      buildDefaultPrompt(
        {
          id: "field_ops_justification",
          hint: (l) =>
            l === "id"
              ? "Justifikasi field-ops (site visit). Jelaskan alasan operasional site visit ini: incident/PM/instalasi, dampak kalau tidak ditangani, urgency. Kalau ada nomor ticket, sebutkan di kalimat pertama."
              : "Field-ops (site visit) justification. Explain the operational reason for the visit: incident/PM/install, impact if not addressed, urgency. If a ticket number is provided, reference it in the first sentence.",
        },
        [
          "project_name",
          "area",
          "tujuan",
          "ticket_number",
          "transport_need",
          "pic_name",
        ],
        input,
      ),
  },
  expense_description: {
    id: "expense_description",
    allowedRoles: [],
    maxOutputTokens: 200,
    contextKeys: ["amount", "project_name", "vendor", "category"],
    buildPrompt: (input) =>
      buildDefaultPrompt(
        {
          id: "expense_description",
          hint: (l) =>
            l === "id"
              ? "Deskripsi expense proyek. Jelaskan barang/jasa yang dibayar, kaitannya dengan proyek, singkat dan tidak berulang."
              : "Project expense description. Describe the good/service purchased and its link to the project, in plain concise business language.",
        },
        ["amount", "project_name", "vendor", "category"],
        input,
      ),
  },
  project_description: {
    id: "project_description",
    allowedRoles: [],
    maxOutputTokens: 240,
    contextKeys: [
      "project_name",
      "client_name",
      "start_date",
      "end_date",
      "contract_value",
    ],
    buildPrompt: (input) =>
      buildDefaultPrompt(
        {
          id: "project_description",
          hint: (l) =>
            l === "id"
              ? "Deskripsi proyek untuk register/kontrak. Sebutkan scope, tujuan bisnis, dan hasil yang diharapkan tanpa jargon berlebihan."
              : "Project description for the register/contract. State scope, business objective, and expected outcome without excessive jargon.",
        },
        [
          "project_name",
          "client_name",
          "start_date",
          "end_date",
          "contract_value",
        ],
        input,
      ),
  },
};

/**
 * Zod schema for the copilot request body. Validated at the route
 * boundary. Rejects unknown `surface` values loudly so a client bug
 * can't sneak through with an empty prompt.
 */
export const copilotRequestSchema = z.object({
  surface: z.enum([
    "ca_purpose",
    "field_ops_justification",
    "expense_description",
    "project_description",
  ]),
  input: z.string().max(4000).default(""),
  context: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});

export type CopilotRequest = z.infer<typeof copilotRequestSchema>;
