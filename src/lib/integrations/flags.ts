import "server-only";
import { parseServerEnv } from "@/lib/env/server";

export const INTEGRATION_VENDORS = ["leadconduit", "calltools"] as const;
export type IntegrationVendor = (typeof INTEGRATION_VENDORS)[number];

export function isIntegrationVendor(value: string): value is IntegrationVendor {
  return (INTEGRATION_VENDORS as readonly string[]).includes(value);
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
      return env.INTEGRATIONS_LEADCONDUIT_ENABLED;
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
