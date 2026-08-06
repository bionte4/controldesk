import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for the clients module (rules §5, §6).
 *
 * Kept intentionally aligned with the DB check constraints in
 * `supabase/migrations/0008_clients_and_projects.sql` — the Zod layer is
 * the *first* defense (server actions), RLS is the second, DB constraints
 * are the third. Any change in one must be replicated in the others.
 */

export const CLIENT_STATUSES = [
  "PROSPECT",
  "ACTIVE",
  "ON_HOLD",
  "CHURNED",
] as const;

export const clientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

const nameField = z
  .string()
  .trim()
  .min(2, "Client name must be at least 2 characters.")
  .max(160, "Client name is too long.");

const optionalTrimmed = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const createClientSchema = z.object({
  name: nameField,
  industry: optionalTrimmed(80, "Industry label is too long."),
  contact_name: optionalTrimmed(120, "Contact name is too long."),
  contact_email: z
    .string()
    .trim()
    .email("Contact email must be a valid email.")
    .max(254)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  contact_phone: optionalTrimmed(32, "Phone number is too long."),
  status: clientStatusSchema.default("PROSPECT"),
  notes: optionalTrimmed(2000, "Notes are too long."),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema
  .partial()
  .extend({ id: uuidSchema });
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

// ---------------------------------------------------------------------------
// BPO contract schema (rules §5)
// ---------------------------------------------------------------------------

export const CONTRACT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "ENDED",
  "RENEWED",
  "TERMINATED",
] as const;
export const contractStatusSchema = z.enum(CONTRACT_STATUSES);
export type ContractStatus = z.infer<typeof contractStatusSchema>;

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD).");

export const createContractSchema = z
  .object({
    client_id: uuidSchema,
    contract_number: z
      .string()
      .trim()
      .min(1, "Contract number is required.")
      .max(64, "Contract number is too long."),
    mrr_amount_idr: z
      .number()
      .int("MRR must be a whole rupiah amount.")
      .nonnegative("MRR cannot be negative."),
    start_date: isoDateSchema,
    end_date: isoDateSchema.optional(),
    status: contractStatusSchema.default("DRAFT"),
    notes: optionalTrimmed(2000, "Notes are too long."),
  })
  .refine(
    (v) => !v.end_date || v.end_date >= v.start_date,
    { path: ["end_date"], message: "End date must be on or after start date." },
  );
export type CreateContractInput = z.infer<typeof createContractSchema>;
