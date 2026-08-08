import { z } from "zod";

import { LOCALES } from "@/lib/i18n/config";
import { isoDateSchema } from "./common";

/**
 * Profile self-service — rules §6 + PDP `decideEmployee` self-update branch.
 *
 * Scope contract: a user editing their own profile may ONLY change the fields
 * below. HR-managed attributes (`role`, `department`, `position_title`,
 * `employment_type`, `join_date`, `contract_end_date`, `monthly_salary`,
 * `hourly_rate`, `bank_account_number`, `email`, `availability`, `is_active`)
 * are display-only in the UI and refused by the Server Action if smuggled in.
 *
 * `first_name` and `last_name` are combined to derive `full_name` at write
 * time so downstream code that keys off `full_name` stays coherent.
 */

const optionalTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^[+()\d\s-]+$/u, "Phone may only contain digits, spaces, +, -, ().")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const updateProfileSchema = z
  .object({
    first_name: z.string().trim().min(1, "First name is required.").max(80),
    last_name: optionalTrimmedText(80),
    phone: phoneSchema,
    date_of_birth: isoDateSchema.optional(),
    preferred_locale: z
      .enum(LOCALES)
      .optional()
      .transform((v) => v ?? undefined),
  })
  .superRefine((val, ctx) => {
    if (val.date_of_birth) {
      const dob = new Date(`${val.date_of_birth}T00:00:00Z`);
      const now = Date.now();
      const ageMs = now - dob.getTime();
      const yearMs = 365.25 * 86_400_000;
      const ageYears = ageMs / yearMs;
      if (ageYears < 17) {
        ctx.addIssue({
          code: "custom",
          path: ["date_of_birth"],
          message: "Employee must be at least 17 years old.",
        });
      }
      if (ageYears > 90) {
        ctx.addIssue({
          code: "custom",
          path: ["date_of_birth"],
          message: "Date of birth looks invalid (age > 90).",
        });
      }
    }
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Password change — enforces a mild strength floor. We do NOT compute password
 * strength server-side beyond the schema; Supabase Auth already rate-limits
 * `updateUser` and rejects breached-password prefixes when configured.
 */
export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required."),
    new_password: z
      .string()
      .min(8, "New password must be at least 8 characters.")
      .max(128)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
        message: "New password must contain both letters and digits.",
      }),
    confirm_password: z.string().min(1, "Confirmation is required."),
  })
  .superRefine((val, ctx) => {
    if (val.new_password !== val.confirm_password) {
      ctx.addIssue({
        code: "custom",
        path: ["confirm_password"],
        message: "New password and confirmation do not match.",
      });
    }
    if (val.new_password === val.current_password) {
      ctx.addIssue({
        code: "custom",
        path: ["new_password"],
        message: "New password must be different from the current one.",
      });
    }
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
