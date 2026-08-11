import type { ServerEnv } from "@/lib/env/server";

export type LeadConduitFlowSlug = "roofing" | "roofing-virtual-quote";

export type LeadConduitFlowBinding = {
  slug: LeadConduitFlowSlug;
  companyId: string;
  flowId: string;
  flowName: "Roofing" | "Roofing Virtual Quote";
  capabilities: {
    shadowImport: boolean;
    polling: boolean;
    receipt: boolean;
    processing: boolean;
    rescueRecommendations: boolean;
    rescueActions: boolean;
  };
  tokens: ReadonlyArray<{ value: string; validUntil: string | null }>;
};

export type LeadConduitReadEnvironment = Pick<ServerEnv,
  | "ACCESS_ROUTE_COMPANY_ID"
  | "LEADCONDUIT_API_KEY"
  | "LEADCONDUIT_BASE_URL"
  | "LEADCONDUIT_ROOFING_FLOW_ID"
  | "LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID"
  | "LEADCONDUIT_SHADOW_PAGE_LIMIT"
  | "LEADCONDUIT_SHADOW_MAX_PAGES"
  | "LEADCONDUIT_PAGE_LIMIT"
  | "LEADCONDUIT_MAX_PAGES"
  | "LEADCONDUIT_INITIAL_LOOKBACK_MINUTES"
>;

function configuredTokens(
  activeToken: string | undefined,
  nextToken: string | undefined,
  nextTokenExpiry: string | undefined,
  now: Date,
): ReadonlyArray<{ value: string; validUntil: string | null }> {
  const tokens: Array<{ value: string; validUntil: string | null }> = [];
  if (activeToken) tokens.push({ value: activeToken, validUntil: null });
  if (nextToken && nextTokenExpiry && new Date(nextTokenExpiry) > now && nextToken !== activeToken) {
    tokens.push({ value: nextToken, validUntil: nextTokenExpiry });
  }
  return tokens;
}

export function getLeadConduitFlowBinding(
  slug: string,
  environment: ServerEnv,
  now = new Date(),
): LeadConduitFlowBinding | null {
  if (!environment.ACCESS_ROUTE_COMPANY_ID) return null;

  if (slug === "roofing" && environment.LEADCONDUIT_ROOFING_FLOW_ID) {
    return {
      slug,
      companyId: environment.ACCESS_ROUTE_COMPANY_ID,
      flowId: environment.LEADCONDUIT_ROOFING_FLOW_ID,
      flowName: "Roofing",
      capabilities: {
        shadowImport: environment.INTEGRATIONS_LEADCONDUIT_ROOFING_SHADOW_IMPORT_ENABLED,
        polling: environment.INTEGRATIONS_LEADCONDUIT_ROOFING_POLLING_ENABLED,
        receipt: environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED,
        processing: environment.INTEGRATIONS_LEADCONDUIT_ROOFING_PROCESSING_ENABLED,
        rescueRecommendations: environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ENABLED,
        rescueActions: environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ACTIONS_ENABLED,
      },
      tokens: configuredTokens(
        environment.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN,
        environment.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT,
        environment.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT,
        now,
      ),
    };
  }

  if (slug === "roofing-virtual-quote" && environment.LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID) {
    return {
      slug,
      companyId: environment.ACCESS_ROUTE_COMPANY_ID,
      flowId: environment.LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID,
      flowName: "Roofing Virtual Quote",
      capabilities: {
        shadowImport: environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_SHADOW_IMPORT_ENABLED,
        polling: environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_POLLING_ENABLED,
        receipt: environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED,
        processing: environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_PROCESSING_ENABLED,
        rescueRecommendations: environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RESCUE_ENABLED,
        rescueActions: environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RESCUE_ACTIONS_ENABLED,
      },
      tokens: configuredTokens(
        environment.LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN,
        environment.LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT,
        environment.LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT_EXPIRES_AT,
        now,
      ),
    };
  }

  return null;
}
