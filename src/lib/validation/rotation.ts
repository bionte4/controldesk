import { z } from "zod";

/**
 * Validation for `markSecretRotatedAction` (rules §22).
 *
 * The `name` must match a row in `secret_rotations` — we bound it to a
 * conservative charset to prevent injection attempts even though the DB
 * itself would reject a non-existent name.
 */
export const markSecretRotatedSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Z0-9_]+$/, "must be UPPER_SNAKE_CASE"),
  notes: z.string().max(500).optional(),
});
export type MarkSecretRotatedInput = z.infer<typeof markSecretRotatedSchema>;
