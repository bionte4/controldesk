import { z } from "zod";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, "Use 2–63 characters. Lowercase letters, digits, hyphens.");

export const createWorkspaceSchema = z
  .object({
    workspaceName: z.string().trim().min(2, "Workspace name is required."),
    workspaceSlug: workspaceSlugSchema,
    fullName: z.string().trim().min(2, "Your full name is required."),
    email: z.string().trim().toLowerCase().email("Enter a valid email."),
    password: z
      .string()
      .min(8, "At least 8 characters.")
      .regex(/[A-Z]/, "Include at least one uppercase letter.")
      .regex(/[a-z]/, "Include at least one lowercase letter.")
      .regex(/[0-9]/, "Include at least one digit."),
  });

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
