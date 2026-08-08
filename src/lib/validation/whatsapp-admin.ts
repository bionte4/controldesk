import { z } from "zod";

/**
 * Zod schemas for the tenant WhatsApp admin surface (rules §17).
 *
 * FONNTE-only in this build: the admin form exposes only the Fonnte
 * provider because that is the tenant's chosen channel. The DB
 * CHECK constraint (migration 0071) still permits TWILIO / META_CLOUD
 * so we retain a forward-compat migration path — the adapter code in
 * `whatsapp/client.ts` for those providers stays dormant.
 *
 * Field notes:
 *   * `phone_number_id` is the WhatsApp number paired to the Fonnte
 *     device — stored for display + audit only. Fonnte's `/send`
 *     endpoint routes purely by device token, not by number.
 *   * `api_token` is the "device token" from
 *     https://md.fonnte.com/new/device — treat like a password
 *     (encrypted at rest via `token-crypto.ts`).
 *   * `account_sid` + `webhook_verify_token` are TWILIO / META_CLOUD
 *     columns; Fonnte writes NULL for both. Kept in the schema as
 *     `.null()` so `saveTenantWhatsAppConfig` receives a well-typed
 *     payload without conditional plumbing at the call site.
 *
 * The behavioural gate — "does this device token actually work?" —
 * lives in `verifyWhatsAppCredentials` (calls Fonnte's `/device`
 * endpoint) and is invoked by the server action BEFORE persist.
 */

// Fonnte accepts either Indonesian local (`08xxx`) or E.164
// (`+62xxx` / `62xxx`). We stay permissive here — the send path
// forwards the token to Fonnte with `countryCode=62` so `0` is
// auto-rewritten. A `whatsapp:` prefix is silently accepted for
// symmetry with the Twilio format (personal linking may store it
// that way).
const FONNTE_PHONE_PATTERN = /^(whatsapp:)?\+?[0-9]{7,15}$/;

export const saveWhatsAppConfigSchema = z.object({
  provider: z.literal("FONNTE"),
  phone_number_id: z
    .string()
    .trim()
    .min(6, "Phone number too short.")
    .max(64, "Phone number too long.")
    .refine((v) => FONNTE_PHONE_PATTERN.test(v), {
      message:
        "Enter the WhatsApp number paired to your Fonnte device, e.g. +6281234567890 or 6281234567890.",
    }),
  api_token: z
    .string()
    .trim()
    .min(10, "Device token is too short.")
    .max(200, "Device token is too long."),
  // Kept explicit + null so the discriminated payload shape stays
  // stable — the repository layer expects the full object.
  account_sid: z.null().optional(),
  webhook_verify_token: z.null().optional(),
});
export type SaveWhatsAppConfigInput = z.infer<typeof saveWhatsAppConfigSchema>;

/**
 * Deactivation carries no input from the client. Kept as an empty
 * object for wrapper uniformity.
 */
export const deactivateWhatsAppConfigSchema = z.object({});
export type DeactivateWhatsAppConfigInput = z.infer<
  typeof deactivateWhatsAppConfigSchema
>;
