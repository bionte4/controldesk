import { z } from "zod";

import { insightKindSchema } from "@/lib/ai/schemas";

export const runInsightSchema = z.object({
  kind: insightKindSchema,
});
export type RunInsightInput = z.infer<typeof runInsightSchema>;

export const runAllInsightsSchema = z.object({});
export type RunAllInsightsInput = z.infer<typeof runAllInsightsSchema>;
