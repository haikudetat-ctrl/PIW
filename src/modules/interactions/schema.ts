import { z } from "zod";
import { interactionTypeSchema } from "@/domain/crm";

export const interactionInputSchema = z.object({
  type: interactionTypeSchema,
  summary: z.string().min(1),
  occurredAt: z.string().min(1).optional(),
});

export type InteractionInput = z.infer<typeof interactionInputSchema>;
