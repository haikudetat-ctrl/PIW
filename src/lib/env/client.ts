import { z } from "zod";
import { booleanString, deploymentEnvironmentSchema } from "./shared";

const optionalString = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(1).optional(),
);

const softTrackingFlag = z.preprocess(
  (value) => value === "true" || value === true ? "true" : "false",
  booleanString,
);

const clientEnvSchema = z.object({
  DEPLOYMENT_ENV: deploymentEnvironmentSchema,
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  META_TRACKING_ENABLED: softTrackingFlag,
  NEXT_PUBLIC_META_PIXEL_ID: optionalString,
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function parseClientEnv(values: Record<string, string | undefined>) {
  const parsed = clientEnvSchema.parse(values);
  const pixelId = parsed.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";
  return {
    ...parsed,
    META_TRACKING_ENABLED: parsed.META_TRACKING_ENABLED && /^\d{6,32}$/.test(pixelId),
    NEXT_PUBLIC_META_PIXEL_ID: /^\d{6,32}$/.test(pixelId) ? pixelId : undefined,
  };
}
