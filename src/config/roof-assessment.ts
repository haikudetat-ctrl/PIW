import { campaignSlugs, type CampaignSlug } from "@/config/campaigns";
import {
  roofAssessmentQuestionIds,
  type RoofAssessmentQuestionId,
} from "@/domain/roof-assessment";

export {roofAssessmentQuestionIds} from "@/domain/roof-assessment";

export const assessmentLoadingStages = [
  "Confirming the address",
  "Locating the roof",
  "Reviewing aerial imagery",
  "Preparing the assessment",
] as const;

export type {RoofAssessmentQuestionId} from "@/domain/roof-assessment";
export type RoofAssessmentPresentationKey = "all-season-main" | CampaignSlug;
export type RoofAssessmentCampaignSlug = CampaignSlug;
export type AssessmentEntryPoint =
  | "main-home"
  | "main-contact"
  | "main-drawer"
  | "roof-estimate"
  | `campaign:${CampaignSlug}`;

export const roofAssessmentPresentationKeys = [
  "all-season-main",
  ...campaignSlugs,
] as const satisfies readonly RoofAssessmentPresentationKey[];

export const roofAssessmentPresentationByCampaign = {
  "weather-report": "weather-report",
  "seasonal-shield": "seasonal-shield",
  "for-every-season": "for-every-season",
} as const satisfies Record<CampaignSlug, RoofAssessmentPresentationKey>;

export const roofAssessmentEntryContexts = {
  "main-home": {campaign: null, presentationKey: "all-season-main"},
  "main-contact": {campaign: null, presentationKey: "all-season-main"},
  "main-drawer": {campaign: null, presentationKey: "all-season-main"},
  "roof-estimate": {campaign: null, presentationKey: "all-season-main"},
  "campaign:weather-report": {campaign: "weather-report", presentationKey: "weather-report"},
  "campaign:seasonal-shield": {campaign: "seasonal-shield", presentationKey: "seasonal-shield"},
  "campaign:for-every-season": {campaign: "for-every-season", presentationKey: "for-every-season"},
} as const satisfies Record<AssessmentEntryPoint, {
  campaign: CampaignSlug | null;
  presentationKey: RoofAssessmentPresentationKey;
}>;

export const roofAssessmentEntryPoints = Object.keys(
  roofAssessmentEntryContexts,
) as AssessmentEntryPoint[];

export type RoofAssessmentContext = {
  key: RoofAssessmentPresentationKey;
  kicker: string;
  headline: string;
  intro: string;
  resultHeadline: string;
  resultIntro: string;
  consultationIntro: string;
  accentClass: string;
  fallbackImage: string;
  fallbackImageAlt: string;
  loadingStages: typeof assessmentLoadingStages;
  questionIds: readonly RoofAssessmentQuestionId[];
};

const shared = {
  loadingStages: assessmentLoadingStages,
  questionIds: roofAssessmentQuestionIds,
} as const;

export const roofAssessmentContexts: Record<RoofAssessmentPresentationKey, RoofAssessmentContext> = {
  "all-season-main": {
    ...shared,
    key: "all-season-main",
    kicker: "Your personalized RoofCheck",
    headline: "A personalized look at your New Jersey roof.",
    intro: "We are checking the property first so every recommendation is grounded in your home.",
    resultHeadline: "Your property-specific project outlook",
    resultIntro: "A practical next step based on your property and the concerns you shared.",
    consultationIntro: "Talk through the roof with an All Season specialist who has your assessment in front of them.",
    accentClass: "assessment-accent-lime",
    fallbackImage: "/campaigns/every-season.jpg",
    fallbackImageAlt: "A New Jersey home prepared for every season",
  },
  "weather-report": {
    ...shared,
    key: "weather-report",
    kicker: "Your seasonal RoofCheck",
    headline: "See what the seasons may have changed.",
    intro: "We are reviewing the property and the condition signals that matter in New Jersey.",
    resultHeadline: "Your roof weather outlook",
    resultIntro: "A grounded view of the age, wear, and weather signals worth reviewing next.",
    consultationIntro: "Review the seasonal signals with a specialist who can put them in context for this property.",
    accentClass: "assessment-accent-cyan",
    fallbackImage: "/campaigns/roof-above.jpg",
    fallbackImageAlt: "A roofer reviewing shingles and flashing on a New Jersey home",
  },
  "seasonal-shield": {
    ...shared,
    key: "seasonal-shield",
    kicker: "Your protection RoofCheck",
    headline: "Understand what is protecting your home.",
    intro: "We are preparing a property-specific assessment before discussing any next step.",
    resultHeadline: "Your home protection outlook",
    resultIntro: "A focused view of the roof conditions that may affect the home beneath it.",
    consultationIntro: "Review the protection priorities with a specialist who has your property details ready.",
    accentClass: "assessment-accent-blue",
    fallbackImage: "/campaigns/roof-above.jpg",
    fallbackImageAlt: "An aerial view of a New Jersey home and its roof",
  },
  "for-every-season": {
    ...shared,
    key: "for-every-season",
    kicker: "Your four-season RoofCheck",
    headline: "Built for every New Jersey season.",
    intro: "We are checking how this roof fits the year-round demands of your property.",
    resultHeadline: "Your four-season project outlook",
    resultIntro: "A long-view recommendation shaped by the roof, the home, and your priorities.",
    consultationIntro: "Talk through durability and timing with a specialist who understands New Jersey roofs.",
    accentClass: "assessment-accent-lime",
    fallbackImage: "/campaigns/every-season.jpg",
    fallbackImageAlt: "A New Jersey home shown through four seasons",
  },
};

export function getRoofAssessmentContext(
  presentation: string | null | undefined,
): RoofAssessmentContext {
  if (presentation && presentation in roofAssessmentContexts) {
    return roofAssessmentContexts[presentation as RoofAssessmentPresentationKey];
  }
  return roofAssessmentContexts["all-season-main"];
}
