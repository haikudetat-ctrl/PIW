import "server-only";
import { z } from "zod";
import { booleanString, deploymentEnvironmentSchema } from "./shared";

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
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(values: Record<string, string | undefined>) {
  return serverEnvSchema.parse(values);
}
