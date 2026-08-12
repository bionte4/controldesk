import { z } from "zod";

import { CANONICAL_ROLES, type CanonicalRole } from "@/lib/rbac/roles";

/**
 * Validation schemas for the Users admin surface (Fase 2 + 3 of the
 * `/settings/users` module).
 *
 * We deliberately validate against `CanonicalRole` (7 codes) rather than the
 * 10 legacy DB codes — new roles are always assigned in canonical form and
 * the server converts to legacy on write via `toLegacyDbRole()`. This keeps
 * the UI free of the migration-transitional double-space.
 *
 * Emails are normalised to lowercase in the schema, so equality checks
 * downstream never miss a case variant.
 */

export const canonicalRoleSchema = z.enum(
  CANONICAL_ROLES as unknown as readonly [CanonicalRole, ...CanonicalRole[]],
);

const emailSchema = z
  .string()
  .trim()
  .min(3, "Email is required")
  .max(320, "Email is too long")
  .email("Invalid email address")
  .transform((v) => v.toLowerCase());

const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Full name must be at least 2 characters")
  .max(120, "Full name is too long");

const reasonSchema = z
  .string()
  .trim()
  .max(500, "Reason is too long")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

/**
 * Invite (Fase 2). Admin fills email + name + role and Supabase Auth sends a
 * magic-link email. On accept, the user sets their own password; the
 * accompanying employees row is created up-front so the JWT `role` claim is
 * populated on first sign-in.
 */
export const inviteUserSchema = z.object({
  email: emailSchema,
  full_name: fullNameSchema,
  role: canonicalRoleSchema.default("EMPLOYEE"),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/**
 * Change the role of an existing user (Fase 3). Guardrails at the server
 * layer:
 *   - actor cannot change their own role
 *   - reason ≥ 15 chars required when moving OUT of TENANT_ADMIN (protect
 *     against accidental self-demotion of the only admin)
 * The UI can pre-flight the second condition via the same schema so users
 * get inline feedback before hitting the server.
 */
export const changeUserRoleSchema = z
  .object({
    user_id: z.string().uuid(),
    new_role: canonicalRoleSchema,
    /**
     * Free-text audit trail note. Server enforces min-length only for
     * sensitive transitions (see handler); the schema keeps the ceiling.
     */
    reason: reasonSchema,
  })
  .strict();
export type ChangeUserRoleInput = z.infer<typeof changeUserRoleSchema>;

/**
 * Deactivate / reactivate. "Deactivate" flips `employees.is_active=false` +
 * bans the auth.users row so no fresh JWT is issued. "Reactivate" reverses
 * both.
 *
 * We do NOT support hard-delete here — retention rules §22 mandate 5-year
 * anonymisation, not row removal.
 */
export const setUserStatusSchema = z
  .object({
    user_id: z.string().uuid(),
    active: z.boolean(),
    reason: reasonSchema,
  })
  .strict();
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

/**
 * Force-logout — revoke every Supabase session for the target user without
 * changing their role/status. Useful when an admin suspects a stale device
 * or the user needs a JWT refresh to pick up an out-of-band change.
 */
export const forceLogoutSchema = z
  .object({
    user_id: z.string().uuid(),
    reason: reasonSchema,
  })
  .strict();
export type ForceLogoutInput = z.infer<typeof forceLogoutSchema>;
