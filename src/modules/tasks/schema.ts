import { z } from "zod";
import { uuidSchema } from "@/domain/ids";

// An untouched HTML input still submits its name with an empty string value
// (FormData never omits the key), so an optional field must tolerate "" the
// same as absent, not just undefined.
const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const taskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  // Plain string, not z.iso.datetime(): an HTML <input type="datetime-local">
  // value has no timezone offset and would fail a strict ISO check.
  dueAt: optionalNonEmptyString,
  assignedTo: uuidSchema.optional(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;
