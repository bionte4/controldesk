/**
 * ControlDesk — Zod schema for the portal user's "change password" flow
 * (rules §28 B.4). Called by `portalChangePasswordAction`.
 *
 * Password policy (mirrors GAS §28 recommendation):
 *   • minimum length 10 characters
 *   • at least one letter AND one digit
 *   • current password must be provided (proof-of-possession)
 *   • confirmation must match new password
 *   • new password must differ from current
 */

import { z } from "zod";

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

const password = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters.`)
  .refine((value) => /[A-Za-z]/.test(value), {
    message: "Password must contain at least one letter.",
  })
  .refine((value) => /\d/.test(value), {
    message: "Password must contain at least one digit.",
  });

export const portalChangePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required."),
    new_password: password,
    confirm_password: z.string().min(1, "Please confirm the new password."),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match.",
  })
  .refine((v) => v.new_password !== v.current_password, {
    path: ["new_password"],
    message: "New password must differ from the current one.",
  });

export type PortalChangePasswordInput = z.infer<
  typeof portalChangePasswordSchema
>;

export const PORTAL_PASSWORD_POLICY = {
  minLength: PASSWORD_MIN,
  maxLength: PASSWORD_MAX,
} as const;
