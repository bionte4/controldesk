/**
 * ControlDesk — Field-Ops Cash Advance Zod schemas.
 *
 * Backs the `saveDraftFieldOpsAction` / `updateDraftFieldOpsAction` /
 * `submitDraftFieldOpsAction` server actions in
 * `src/app/(app)/finance/cash-advances/field-ops-actions.ts` (Fase 1.6).
 *
 * Data lives in three tables:
 *   - `cash_advances`                       (parent, ca_type='FIELD_OPS')
 *   - `cash_advance_field_ops_details`      (1:1, section 1-3 form fields)
 *   - `cash_advance_rab_lines`              (N:1, RAB breakdown; SUM drives
 *                                            cash_advances.amount via trigger)
 *
 * The DRAFT stage is permissive — an employee can save partial data and
 * come back to it. The SUBMIT stage tightens all required fields on the
 * server side. See `submitReadyFieldOpsSchema` below.
 */

import { z } from "zod";

import { idrAmountSchema, isoDateSchema, uuidSchema } from "./common";

// ---------------------------------------------------------------------------
// Primitive helpers.
// ---------------------------------------------------------------------------

const optionalShort = z
  .string()
  .trim()
  .max(256)
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v));

const optionalLong = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v));

/**
 * Indonesian phone numbers. We accept +62 / 62 / 08 prefixes with 8-14
 * digits after normalisation. Optional at draft time; required-when-set
 * validation happens at the submit gate.
 */
const optionalPhone = z
  .string()
  .trim()
  .max(32)
  .regex(
    /^(?:$|\+?\d[\d\s\-()]{6,30}\d)$/u,
    "Use a valid phone number (e.g. +62 812 3456 7890).",
  )
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v));

/**
 * Bank account number — 6-24 digits after stripping separators. We
 * store the normalised digits-only form to make lookups deterministic.
 */
const optionalBankAccount = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((v) => {
    if (v === undefined || v === "") return undefined;
    const digits = v.replace(/[^\d]/gu, "");
    return digits === "" ? undefined : digits;
  })
  .refine((v) => v === undefined || (v.length >= 6 && v.length <= 24), {
    message: "Bank account number must be 6-24 digits.",
  });

// ---------------------------------------------------------------------------
// RAB line — a single row inside `cash_advance_rab_lines`.
// ---------------------------------------------------------------------------

export const rabLineDraftSchema = z.object({
  /** Server-assigned; absent for new lines. */
  id: uuidSchema.optional(),
  seq: z.number().int().min(1).max(999).optional(),
  category: z.string().trim().min(1, "Category is required.").max(64),
  detail: optionalLong,
  amount: idrAmountSchema
    .refine((v) => v > 0, { message: "Amount must be greater than zero." })
    .refine((v) => v <= 999_999_999_999, {
      message: "Amount exceeds allowed maximum.",
    }),
  /**
   * Optional GL account (Chart of Accounts). Different RAB categories
   * typically hit different accounts — Transportasi → 5301, Akomodasi
   * → 5302, Konsumsi → 5303. Kept optional during rollout; verified at
   * server-action level when present.
   */
  coa_id: uuidSchema
    .nullish()
    .transform((v) => (v === null || v === undefined ? undefined : v)),
});
export type RabLineDraft = z.infer<typeof rabLineDraftSchema>;

// ---------------------------------------------------------------------------
// SAVE DRAFT — minimum required to persist a partial form. The submit
// gate enforces everything the mockup marks with `*`. Both schemas share
// the same shape so the UI can bind a single React Hook Form to both.
// ---------------------------------------------------------------------------

export const saveDraftFieldOpsSchema = z.object({
  project_id: uuidSchema,

  // Section 1 — Informasi Pekerjaan & Site.
  ticket_number: z
    .string()
    .trim()
    .min(1, "Ticket / SPK number is required.")
    .max(64, "Ticket number is too long."),
  justification: optionalLong,
  unit_pengaju: optionalShort,
  cid_company: optionalShort,
  area: optionalShort,
  tujuan: optionalShort,
  pic_name: optionalShort,
  pic_phone: optionalPhone,
  pickup_key_bts: z.boolean().optional().default(false),

  // Section 2 — Transportasi & Lokasi.
  transport_need: optionalShort,
  jarak_pp_km: z
    .number()
    .min(0, "Distance cannot be negative.")
    .max(9999, "Distance seems unrealistic.")
    .optional(),
  gmap_duration: optionalShort,
  driver_phone: optionalPhone,

  // Section 3 — Rekening Pencairan.
  bank_owner_name: optionalShort,
  bank_name: optionalShort,
  bank_account_no: optionalBankAccount,

  // Meta.
  needed_by: isoDateSchema.optional(),
  purpose: optionalLong,

  // RAB rows — at least 0 for save-draft (the client may want to save
  // meta fields before typing rows). Submit gate re-checks ≥1.
  rab_lines: z.array(rabLineDraftSchema).max(50).default([]),
});
export type SaveDraftFieldOpsInput = z.infer<typeof saveDraftFieldOpsSchema>;

// ---------------------------------------------------------------------------
// UPDATE DRAFT — same shape + row id.
// ---------------------------------------------------------------------------

export const updateDraftFieldOpsSchema = saveDraftFieldOpsSchema.extend({
  id: uuidSchema,
});
export type UpdateDraftFieldOpsInput = z.infer<
  typeof updateDraftFieldOpsSchema
>;

// ---------------------------------------------------------------------------
// SUBMIT — the server takes just the row id and re-validates the loaded
// row against `submitReadyFieldOpsSchema` before advancing the state
// machine. This keeps the client contract minimal while enforcing the
// mockup's required-at-submit rules on the server side.
// ---------------------------------------------------------------------------

export const submitDraftFieldOpsSchema = z.object({
  id: uuidSchema,
});
export type SubmitDraftFieldOpsInput = z.infer<
  typeof submitDraftFieldOpsSchema
>;

/**
 * Server-side gate applied to the row loaded from the DB immediately
 * before transition DRAFT → PENDING_SUPERVISOR. Only the fields the
 * mockup marks with `*` at submit time are required; MA (`budget_detail_id`)
 * remains optional and is re-coded by PM/Finance during review — same
 * contract as expenses (rules §9).
 */
export const submitReadyFieldOpsSchema = z.object({
  project_id: uuidSchema,
  ticket_number: z.string().trim().min(1),
  unit_pengaju: z.string().trim().min(1, "Unit pengaju wajib diisi."),
  area: z.string().trim().min(1, "Area wajib diisi."),
  tujuan: z.string().trim().min(1, "Tujuan wajib diisi."),
  transport_need: z
    .string()
    .trim()
    .min(1, "Kebutuhan transportasi wajib diisi."),
  bank_owner_name: z
    .string()
    .trim()
    .min(1, "Nama pemilik rekening wajib diisi."),
  bank_name: z.string().trim().min(1, "Nama bank wajib diisi."),
  bank_account_no: z
    .string()
    .trim()
    .regex(/^\d{6,24}$/u, "No rekening 6-24 digit."),
  rab_lines: z
    .array(rabLineDraftSchema)
    .min(1, "Minimal 1 baris RAB.")
    .max(50, "Maksimal 50 baris RAB."),
});
export type SubmitReadyFieldOps = z.infer<typeof submitReadyFieldOpsSchema>;

// ---------------------------------------------------------------------------
// DELETE DRAFT — just the id.
// ---------------------------------------------------------------------------

export const deleteDraftFieldOpsSchema = z.object({
  id: uuidSchema,
});
export type DeleteDraftFieldOpsInput = z.infer<
  typeof deleteDraftFieldOpsSchema
>;
