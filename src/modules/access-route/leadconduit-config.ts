import type { ServerEnv } from "@/lib/env/server";

export type LeadConduitFlowSlug = "roofing" | "roofing-virtual-quote";

export const LEADCONDUIT_RECEIPT_FLOW_IDS = {
  roofing: "6377949a81800d03d54119b5",
  "roofing-virtual-quote": "68d597a7e5a45ce2a9c822fe",
} as const;

export type LeadConduitFlowBinding = {
  slug: LeadConduitFlowSlug;
  companyId: string;
  flowId: string;
  flowName: "Roofing" | "Roofing Virtual Quote";
  receiptEnabled: boolean;
  tokens: ReadonlyArray<{ value: string; validUntil: string | null }>;
};

export type LeadConduitReceiptEnvironment = Pick<ServerEnv,
  | "ACCESS_ROUTE_COMPANY_ID"
  | "LEADCONDUIT_ROOFING_FLOW_ID"
  | "LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID"
  | "INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED"
  | "INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED"
  | "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN"
  | "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT"
  | "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT"
  | "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN"
  | "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT"
  | "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT_EXPIRES_AT"
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

  if (slug === "roofing" && environment.LEADCONDUIT_ROOFING_FLOW_ID === LEADCONDUIT_RECEIPT_FLOW_IDS.roofing) {
    return {
      slug,
      companyId: environment.ACCESS_ROUTE_COMPANY_ID,
      flowId: environment.LEADCONDUIT_ROOFING_FLOW_ID,
      flowName: "Roofing",
      receiptEnabled: environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED,
      tokens: configuredTokens(
        environment.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN,
        environment.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT,
        environment.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT,
        now,
      ),
    };
  }

  if (
    slug === "roofing-virtual-quote"
    && environment.LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID === LEADCONDUIT_RECEIPT_FLOW_IDS["roofing-virtual-quote"]
  ) {
    return {
      slug,
      companyId: environment.ACCESS_ROUTE_COMPANY_ID,
      flowId: environment.LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID,
      flowName: "Roofing Virtual Quote",
      receiptEnabled: environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED,
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
