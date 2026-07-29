import { z } from "zod";

export const uuidSchema = z.uuid();
export type UUID = z.infer<typeof uuidSchema>;
