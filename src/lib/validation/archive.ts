import { z } from "zod";

export const archiveIdSchema = z.object({
  id: z.string().uuid(),
});
export type ArchiveIdInput = z.infer<typeof archiveIdSchema>;
