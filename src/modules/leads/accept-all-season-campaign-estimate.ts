import type { CampaignSlug } from "@/config/campaigns";
import type {
  AssessmentEntryPoint,
  RoofAssessmentPresentationKey,
  StartAssessmentInput,
  StartAssessmentResult,
} from "@/modules/roof-assessment/start-or-resume";

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
  campaign: CampaignSlug | null;
  presentationKey: RoofAssessmentPresentationKey;
  entryPoint: AssessmentEntryPoint;
  name: string;
  email: string;
  phone: string;
  submittedAddress: string;
  googlePlaceId?: string;
  clientIpAddress: string;
  clientUserAgent: string;
  submittedAt: string;
  disclosureVersion: string;
  referrer: string | null;
  attribution: CampaignAttribution;
};

export type AcceptAllSeasonCampaignEstimateDependencies = {
  companyId: string;
  startAssessment: (input: StartAssessmentInput) => Promise<StartAssessmentResult>;
};

export async function acceptAllSeasonCampaignEstimate(
  input: AllSeasonCampaignEstimateLeadInput,
  dependencies: AcceptAllSeasonCampaignEstimateDependencies,
) {
  return dependencies.startAssessment({
    submissionId: input.submissionId,
    companyId: dependencies.companyId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    submittedAddress: input.submittedAddress,
    googlePlaceId: input.googlePlaceId,
    campaign: input.campaign,
    presentationKey: input.presentationKey,
    entryPoint: input.entryPoint,
    attribution: input.attribution,
    referrer: input.referrer,
    consent: {
      disclosureVersion: input.disclosureVersion,
      ipAddress: input.clientIpAddress,
      userAgent: input.clientUserAgent,
      grantedAt: input.submittedAt,
    },
  });
}
