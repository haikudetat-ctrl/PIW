import "server-only";
import { z } from "zod";
import { booleanString, deploymentEnvironmentSchema } from "./shared";

const optionalString = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.url().optional());
const optionalUuid = z.preprocess((value) => value === "" ? undefined : value, z.uuid().optional());

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    DEPLOYMENT_ENV: deploymentEnvironmentSchema,
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    INNGEST_EVENT_KEY: z.string().min(1),
    INNGEST_SIGNING_KEY: z.string().min(1),
    PAID_PROVIDERS_ENABLED: booleanString,
    INTEGRATIONS_LEADCONDUIT_ENABLED: booleanString,
    INTEGRATIONS_CALLTOOLS_ENABLED: booleanString,
    INTEGRATIONS_WEBHOOK_SHARED_SECRET: z.string().optional(),
    LEADCONDUIT_API_KEY: z.string().optional(),
    CALLTOOLS_API_KEY: z.string().optional(),
    GOOGLE_MAPS_API_KEY: optionalString,
    ESTIMATE_SMS_WEBHOOK_URL: optionalUrl,
    ESTIMATE_EMAIL_WEBHOOK_URL: optionalUrl,
    ESTIMATE_DELIVERY_SHARED_SECRET: optionalString,
    ROOF_ESTIMATE_COMPANY_ID: optionalUuid,
  })
  .superRefine((value, context) => {
    if (
      value.PAID_PROVIDERS_ENABLED &&
      ["preview", "test"].includes(value.DEPLOYMENT_ENV)
    ) {
      context.addIssue({
        code: "custom",
        path: ["PAID_PROVIDERS_ENABLED"],
        message: "Paid providers cannot be enabled in preview or test",
      });
    }
    if (value.PAID_PROVIDERS_ENABLED && !value.GOOGLE_MAPS_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_MAPS_API_KEY"],
        message: "Google Maps API key is required when paid providers are enabled",
      });
    }
    if (
      (value.ESTIMATE_SMS_WEBHOOK_URL || value.ESTIMATE_EMAIL_WEBHOOK_URL) &&
      !value.ESTIMATE_DELIVERY_SHARED_SECRET
    ) {
      context.addIssue({
        code: "custom",
        path: ["ESTIMATE_DELIVERY_SHARED_SECRET"],
        message: "Estimate delivery webhooks require a shared secret",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(values: Record<string, string | undefined>) {
  return serverEnvSchema.parse(values);
}
