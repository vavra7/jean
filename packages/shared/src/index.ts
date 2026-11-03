import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  value: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
