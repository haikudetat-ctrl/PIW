export type CampaignAttribution = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
};

export type AllSeasonCampaignEstimateLeadInput = {
  submissionId: string;
  campaign: string;
  name: string;
  email: string;
  phone: string;
  submittedAddress: string;
  googlePlaceId?: string;
  clientIpAddress: string;
  clientUserAgent: string;
  submittedAt: string;
  attribution: CampaignAttribution;
};

type CreatedCampaignEstimateRecords = {
  leadId: string;
  propertyId: string;
  pipelineRunId: string;
  publicToken: string;
  event: DomainEvent;
  isDuplicate?: boolean;
};

export type AcceptAllSeasonCampaignEstimateDependencies = {
  createEstimateRecords: (
    input: AllSeasonCampaignEstimateLeadInput & {
      correlationId: string;
      disclosureVersion: "all-season-campaign-estimate-v1";
    },
  ) => Promise<CreatedCampaignEstimateRecords>;
  publishPersistedLeadSubmitted: (event: DomainEvent) => Promise<void>;
};

export async function acceptAllSeasonCampaignEstimate(
  input: AllSeasonCampaignEstimateLeadInput,
  dependencies: AcceptAllSeasonCampaignEstimateDependencies,
) {
  const correlationId = input.submissionId;
  const created = await dependencies.createEstimateRecords({
    ...input,
    correlationId,
    disclosureVersion: "all-season-campaign-estimate-v1",
  });

  if (!created.isDuplicate) {
    await dependencies.publishPersistedLeadSubmitted(created.event);
  }

  return {
    leadId: created.leadId,
    publicToken: created.publicToken,
    resultPath: `/roof-estimate/${created.publicToken}`,
  };
}
import type { DomainEvent } from "@/domain/events";
