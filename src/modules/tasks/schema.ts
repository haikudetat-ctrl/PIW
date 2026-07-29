import { z } from "zod";
import { uuidSchema } from "@/domain/ids";

export const taskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  // Plain string, not z.iso.datetime(): an HTML <input type="datetime-local">
  // value has no timezone offset and would fail a strict ISO check.
  dueAt: z.string().min(1).optional(),
  assignedTo: uuidSchema.optional(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;
