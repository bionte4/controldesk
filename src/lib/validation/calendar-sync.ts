import { z } from "zod";

/**
 * Zod schemas for the Google Calendar Sync admin surface
 * (rules §17). One schema per server action; kept in this shared
 * module so tests can validate the contract independently of the
 * action-wrapper machinery.
 */

export const retryEventSchema = z.object({
  eventId: z.string().uuid(),
});
export type RetryEventInput = z.infer<typeof retryEventSchema>;

export const skipEventSchema = z.object({
  eventId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(4, "Reason must be at least 4 characters.")
    .max(500, "Reason must be at most 500 characters."),
});
export type SkipEventInput = z.infer<typeof skipEventSchema>;

/**
 * "Run reconciliation" has no input from the client. We still keep
 * an empty Zod object so `withSecureAction` treats it uniformly
 * with the other actions in this module.
 */
export const runReconciliationSchema = z.object({});
export type RunReconciliationInput = z.infer<typeof runReconciliationSchema>;
