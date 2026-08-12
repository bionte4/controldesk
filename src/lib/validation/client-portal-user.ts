/**
 * ControlDesk — validation schemas for Client Portal user administration
 * (rules §28 B.4 admin). These are consumed by Server Actions in
 * `src/app/(app)/clients/[id]/portal-users/actions.ts`.
 */

import { z } from "zod";

export const CLIENT_PORTAL_USER_STATUS = [
  "PENDING_ACTIVATION",
  "ACTIVE",
  "DISABLED",
  "LOCKED",
] as const;
export type ClientPortalUserStatus =
  (typeof CLIENT_PORTAL_USER_STATUS)[number];

/** Trimmed, lower-cased email. */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Email is required.")
  .max(320, "Email too long.")
  .email("Enter a valid email.");

/** Non-empty display name capped at a reasonable size. */
const fullName = z
  .string()
  .trim()
  .min(2, "Full name is required.")
  .max(120, "Full name too long.");

export const createClientPortalUserSchema = z.object({
  clientId: z.string().uuid({ message: "Invalid client id." }),
  email,
  full_name: fullName,
});
export type CreateClientPortalUserInput = z.infer<
  typeof createClientPortalUserSchema
>;

export const resetClientPortalUserPasswordSchema = z.object({
  clientPortalUserId: z.string().uuid({ message: "Invalid portal user id." }),
});
export type ResetClientPortalUserPasswordInput = z.infer<
  typeof resetClientPortalUserPasswordSchema
>;

export const updateClientPortalUserStatusSchema = z.object({
  clientPortalUserId: z.string().uuid({ message: "Invalid portal user id." }),
  status: z.enum(["ACTIVE", "DISABLED"]),
});
export type UpdateClientPortalUserStatusInput = z.infer<
  typeof updateClientPortalUserStatusSchema
>;
