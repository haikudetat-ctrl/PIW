import { z } from "zod";

export const confidenceSchema = z.number().int().min(0).max(100);
export const observationMethodSchema = z.enum([
  "measured",
  "calculated",
  "assumed",
  "reported",
]);
export const observationStatusSchema = z.enum([
  "current",
  "superseded",
  "disputed",
  "rejected",
]);
