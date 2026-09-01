import { z } from "zod";
import { booleanString, deploymentEnvironmentSchema } from "./shared";

const optionalString = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(1).optional(),
);

const clientEnvSchema = z
  .object({
    DEPLOYMENT_ENV: deploymentEnvironmentSchema,
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    META_TRACKING_ENABLED: booleanString,
    NEXT_PUBLIC_META_PIXEL_ID: optionalString,
  })
  .superRefine((value, context) => {
    if (value.META_TRACKING_ENABLED && !value.NEXT_PUBLIC_META_PIXEL_ID) {
      context.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_META_PIXEL_ID"],
        message: "Public Meta Pixel ID is required when Meta tracking is enabled",
      });
    }
  });

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function parseClientEnv(values: Record<string, string | undefined>) {
  return clientEnvSchema.parse(values);
}
