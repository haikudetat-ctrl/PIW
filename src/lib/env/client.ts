import { z } from "zod";
import { deploymentEnvironmentSchema } from "./shared";

const clientEnvSchema = z.object({
  DEPLOYMENT_ENV: deploymentEnvironmentSchema,
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function parseClientEnv(values: Record<string, string | undefined>) {
  return clientEnvSchema.parse(values);
}
