import { z } from "zod";

/**
 * Zod schemas for the tenant WhatsApp admin surface (rules §17).
 *
 * Phase A (this build): tenants pick between **Fonnte** and **Twilio**
 * from the admin form. The full adapter dispatch (send, verify) for
 * BOTH providers already exists in `whatsapp/client.ts` — the picker
 * simply un-hides Twilio which was previously kept out of the UI until
 * both adapters were verified end-to-end.
 *
 * Meta Cloud API stays hidden — `whatsapp/client.ts::sendWhatsAppMessage`
 * still returns `NOT_IMPLEMENTED` for META_CLOUD, so exposing it in the
 * form would be a footgun. The DB CHECK still permits the value so
 * legacy rows (or the eventual Phase B implementation) migrate cleanly.
 *
 * The submit path is a Zod discriminated union keyed on `provider`. The
 * two branches share `phone_number_id` and `api_token` (with per-provider
 * validation rules and hints) and Twilio adds `account_sid`. Fonnte
 * always writes NULL for `account_sid` / `webhook_verify_token` so the
 * repository call receives a fully-typed payload without conditional
 * plumbing at the call site.
 */

// Fonnte accepts either Indonesian local (`08xxx`) or E.164
// (`+62xxx` / `62xxx`). We stay permissive here — the send path
// forwards the token to Fonnte with `countryCode=62` so `0` is
// auto-rewritten. A `whatsapp:` prefix is silently accepted for
// symmetry with the Twilio format (personal linking may store it
// that way).
const FONNTE_PHONE_PATTERN = /^(whatsapp:)?\+?[0-9]{7,15}$/;

// Twilio expects `whatsapp:+E164`. We accept either the bare E.164
// number or the prefixed form — the send adapter normalises before
// hitting the API. The strict `+`-prefixed E.164 keeps admins from
// pasting bare local numbers by accident (Twilio rejects those).
const TWILIO_PHONE_PATTERN = /^(whatsapp:)?\+[1-9][0-9]{6,14}$/;

// Twilio Account SID is `AC` followed by exactly 32 hex chars.
const TWILIO_SID_PATTERN = /^AC[a-f0-9]{32}$/i;

const fonnteConfigSchema = z.object({
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
  account_sid: z.null().optional(),
  webhook_verify_token: z.null().optional(),
});

const twilioConfigSchema = z.object({
  provider: z.literal("TWILIO"),
  phone_number_id: z
    .string()
    .trim()
    .min(6, "WhatsApp number too short.")
    .max(80, "WhatsApp number too long.")
    .refine((v) => TWILIO_PHONE_PATTERN.test(v), {
      message:
        "Enter the WhatsApp Business number in E.164 form, e.g. +14155238886.",
    }),
  api_token: z
    .string()
    .trim()
    .min(20, "Twilio Auth Token looks too short.")
    .max(300, "Twilio Auth Token is too long."),
  account_sid: z
    .string()
    .trim()
    .refine((v) => TWILIO_SID_PATTERN.test(v), {
      message:
        "Twilio Account SID must start with AC followed by 32 hex characters.",
    }),
  webhook_verify_token: z.null().optional(),
});

export const saveWhatsAppConfigSchema = z.discriminatedUnion("provider", [
  fonnteConfigSchema,
  twilioConfigSchema,
]);
export type SaveWhatsAppConfigInput = z.infer<typeof saveWhatsAppConfigSchema>;

/**
 * Deactivation carries no input from the client. Kept as an empty
 * object for wrapper uniformity.
 */
export const deactivateWhatsAppConfigSchema = z.object({});
export type DeactivateWhatsAppConfigInput = z.infer<
  typeof deactivateWhatsAppConfigSchema
>;
