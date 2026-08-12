import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  password: z.string().min(8, "At least 8 characters."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const magicLinkSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
});

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Please enter your full name."),
    email: z.string().trim().toLowerCase().email("Enter a valid email."),
    password: z
      .string()
      .min(8, "At least 8 characters.")
      .regex(/[A-Z]/, "Include at least one uppercase letter.")
      .regex(/[a-z]/, "Include at least one lowercase letter.")
      .regex(/[0-9]/, "Include at least one digit."),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export type RegisterInput = z.infer<typeof registerSchema>;
