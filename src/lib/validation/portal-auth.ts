/**
 * ControlDesk — Client Portal auth Zod schemas.
 */

import { z } from "zod";

export const portalLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(320),
  password: z.string().min(1, "Password required.").max(200),
});

export type PortalLoginInput = z.infer<typeof portalLoginSchema>;
