import { z } from "zod";

export const deploymentEnvironmentSchema = z.enum([
  "development",
  "test",
  "preview",
  "production",
]);

export const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
