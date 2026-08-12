import "server-only";
import { parseServerEnv } from "@/lib/env/server";

export const INTEGRATION_VENDORS = [
  "leadconduit",
  "leadmaster",
  "jobnimbus",
  "calltools",
] as const;
export type IntegrationVendor = (typeof INTEGRATION_VENDORS)[number];

// LeadConduit is intentionally excluded: its webhook route is tenant-bound
// and flow-bound, while these vendors use the generic primary-company route.
export const GENERIC_WEBHOOK_VENDORS = ["leadmaster", "jobnimbus", "calltools"] as const;
export type GenericWebhookVendor = (typeof GENERIC_WEBHOOK_VENDORS)[number];

export type LeadConduitReceiptFlags = {
  roofing: boolean;
  virtualQuote: boolean;
};

export function isIntegrationVendor(value: string): value is IntegrationVendor {
  return (INTEGRATION_VENDORS as readonly string[]).includes(value);
}

export function isGenericWebhookVendor(value: string): value is GenericWebhookVendor {
  return (GENERIC_WEBHOOK_VENDORS as readonly string[]).includes(value);
}

// Every destination defaults to off. A vendor stays wired into the app
// (route, table, tests) while access is pending; flipping it on is a config
// change, not a deploy.
export function isIntegrationEnabled(
  vendor: IntegrationVendor,
  values: Record<string, string | undefined> = process.env,
): boolean {
  const env = parseServerEnv(values);
  switch (vendor) {
    case "leadconduit":
      return env.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED
        || env.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED;
    case "leadmaster":
      return env.INTEGRATIONS_LEADMASTER_ENABLED;
    case "jobnimbus":
      return env.INTEGRATIONS_JOBNIMBUS_ENABLED;
    case "calltools":
      return env.INTEGRATIONS_CALLTOOLS_ENABLED;
  }
}

export function integrationFlagsSnapshot(
  values: Record<string, string | undefined> = process.env,
): Record<IntegrationVendor, boolean> {
  return Object.fromEntries(
    INTEGRATION_VENDORS.map((vendor) => [vendor, isIntegrationEnabled(vendor, values)]),
  ) as Record<IntegrationVendor, boolean>;
}

export function leadConduitReceiptFlagsSnapshot(
  values: Record<string, string | undefined> = process.env,
): LeadConduitReceiptFlags {
  const env = parseServerEnv(values);
  return {
    roofing: env.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED,
    virtualQuote: env.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED,
  };
}
