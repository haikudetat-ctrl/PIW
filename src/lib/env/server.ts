import "server-only";
import { z } from "zod";
import { booleanString, deploymentEnvironmentSchema } from "./shared";

const optionalString = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.url().optional());
const optionalUuid = z.preprocess((value) => value === "" ? undefined : value, z.uuid().optional());
const optionalIsoDatetime = z.preprocess((value) => value === "" ? undefined : value, z.iso.datetime().optional());

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
    INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: booleanString,
    INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED: booleanString,
    INTEGRATIONS_LEADMASTER_ENABLED: booleanString,
    INTEGRATIONS_JOBNIMBUS_ENABLED: booleanString,
    INTEGRATIONS_CALLTOOLS_ENABLED: booleanString,
    INTEGRATIONS_WEBHOOK_SHARED_SECRET: z.string().optional(),
    LEADCONDUIT_ROOFING_FLOW_ID: optionalString,
    LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID: optionalString,
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: optionalString,
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: optionalString,
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: optionalIsoDatetime,
    LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN: optionalString,
    LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT: optionalString,
    LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: optionalIsoDatetime,
    LEADMASTER_ACCESS_TOKEN: optionalString,
    LEADMASTER_BASE_URL: optionalUrl,
    LEADMASTER_WORKGROUPS: optionalString,
    LEADMASTER_LOOKBACK_MINUTES: z.coerce.number().int().positive().default(1440),
    JOBNIMBUS_API_KEY: optionalString,
    JOBNIMBUS_BASE_URL: optionalUrl,
    JOBNIMBUS_CONTACTS_PATH: optionalString,
    JOBNIMBUS_JOBS_PATH: optionalString,
    JOBNIMBUS_INCLUDE_SOLD_VALUE: booleanString,
    JOBNIMBUS_PAGE_LIMIT: z.coerce.number().int().positive().max(500).default(50),
    JOBNIMBUS_MAX_PAGES: z.coerce.number().int().positive().max(25).default(1),
    ACCESS_ROUTE_COMPANY_ID: optionalUuid,
    CALLTOOLS_API_KEY: z.string().optional(),
    GOOGLE_MAPS_API_KEY: optionalString,
    GOOGLE_MAPS_BROWSER_API_KEY: optionalString,
    ESTIMATE_SMS_WEBHOOK_URL: optionalUrl,
    ESTIMATE_EMAIL_WEBHOOK_URL: optionalUrl,
    ESTIMATE_DELIVERY_SHARED_SECRET: optionalString,
    // Slack is an optional downstream notification. Keep its value isolated
    // from core environment validation so a malformed webhook cannot prevent
    // lead intake, Supabase access, or Google enrichment. The Slack sender
    // owns delivery validation and records a failed handoff when fetch rejects.
    SLACK_CONTEXT_DIALER_WEBHOOK_URL: optionalString,
    CONTEXT_DIALER_BASE_URL: optionalUrl,
    VERCEL_PROJECT_PRODUCTION_URL: optionalString,
    VERCEL_URL: optionalString,
    ROOF_ESTIMATE_COMPANY_ID: optionalUuid,
    COST_INTELLIGENCE_ENABLED: booleanString,
    COST_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(1500),
    SLACK_COST_DIGEST_WEBHOOK_URL: optionalString,
    VERCEL_API_TOKEN: optionalString,
    VERCEL_TEAM_ID: optionalString,
    DIGITALOCEAN_TOKEN: optionalString,
    GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: optionalString,
    GOOGLE_CLOUD_BILLING_PROJECT_ID: optionalString,
    GOOGLE_CLOUD_BILLING_TABLE: optionalString,
    SUPABASE_COST_CONFIG_JSON: optionalString,
    COST_RESOURCE_MAP_JSON: optionalString,
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
    const readIntegrations = [
      [value.INTEGRATIONS_LEADMASTER_ENABLED, value.LEADMASTER_ACCESS_TOKEN, "LEADMASTER_ACCESS_TOKEN"],
      [value.INTEGRATIONS_JOBNIMBUS_ENABLED, value.JOBNIMBUS_API_KEY, "JOBNIMBUS_API_KEY"],
    ] as const;
    for (const [enabled, credential, path] of readIntegrations) {
      if (enabled && !credential) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} is required when its read integration is enabled`,
        });
      }
    }
    const leadConduitFlows = [
      {
        flowId: value.LEADCONDUIT_ROOFING_FLOW_ID,
        activeToken: value.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN,
        nextToken: value.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT,
        nextTokenExpiry: value.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT,
        receiver: value.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED,
        flowIdPath: "LEADCONDUIT_ROOFING_FLOW_ID",
        tokenPath: "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN",
        nextTokenExpiryPath: "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT",
      },
      {
        flowId: value.LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID,
        activeToken: value.LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN,
        nextToken: value.LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT,
        nextTokenExpiry: value.LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT_EXPIRES_AT,
        receiver: value.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED,
        flowIdPath: "LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID",
        tokenPath: "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN",
        nextTokenExpiryPath: "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT_EXPIRES_AT",
      },
    ] as const;

    for (const flow of leadConduitFlows) {
      if (flow.receiver && !flow.flowId) {
        context.addIssue({
          code: "custom",
          path: [flow.flowIdPath],
          message: `${flow.flowIdPath} is required when its LeadConduit receiver is enabled`,
        });
      }
      if (flow.receiver && !value.ACCESS_ROUTE_COMPANY_ID) {
        context.addIssue({
          code: "custom",
          path: ["ACCESS_ROUTE_COMPANY_ID"],
          message: "ACCESS_ROUTE_COMPANY_ID is required when a LeadConduit receiver is enabled",
        });
      }
      if (flow.receiver && !flow.activeToken) {
        context.addIssue({
          code: "custom",
          path: [flow.tokenPath],
          message: `${flow.tokenPath} is required when its LeadConduit receiver is enabled`,
        });
      }
      if (flow.nextToken && !flow.nextTokenExpiry) {
        context.addIssue({
          code: "custom",
          path: [flow.nextTokenExpiryPath],
          message: `${flow.nextTokenExpiryPath} is required when a next LeadConduit webhook token is configured`,
        });
      }
      if (flow.nextToken && flow.nextTokenExpiry && new Date(flow.nextTokenExpiry) <= new Date()) {
        context.addIssue({
          code: "custom",
          path: [flow.nextTokenExpiryPath],
          message: `${flow.nextTokenExpiryPath} must be in the future`,
        });
      }
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
