export const assessmentLoadingStages = [
  "Confirming the address",
  "Locating the roof",
  "Reviewing aerial imagery",
  "Preparing the assessment",
] as const;

export type RoofAssessmentCampaignSlug =
  | "do-it-right-once"
  | "weather-report"
  | "seasonal-shield"
  | "for-every-season";

export type RoofAssessmentContext = {
  slug: RoofAssessmentCampaignSlug;
  kicker: string;
  headline: string;
  intro: string;
  accentClass: string;
  fallbackImage: string;
  loadingStages: typeof assessmentLoadingStages;
};

const assessmentContexts: Record<RoofAssessmentCampaignSlug, RoofAssessmentContext> = {
  "do-it-right-once": {
    slug: "do-it-right-once",
    kicker: "Your personalized RoofCheck",
    headline: "A clearer decision starts here.",
    intro: "We are combining your answers with the property details we can verify remotely.",
    accentClass: "assessment-accent-lime",
    fallbackImage: "/campaigns/every-season.jpg",
    loadingStages: assessmentLoadingStages,
  },
  "weather-report": {
    slug: "weather-report",
    kicker: "Your personalized RoofCheck",
    headline: "See what the seasons may have changed.",
    intro: "We are reviewing the property and the condition signals that matter in New Jersey.",
    accentClass: "assessment-accent-cyan",
    fallbackImage: "/campaigns/roof-above.jpg",
    loadingStages: assessmentLoadingStages,
  },
  "seasonal-shield": {
    slug: "seasonal-shield",
    kicker: "Your personalized RoofCheck",
    headline: "Understand what is protecting your home.",
    intro: "We are preparing a property-specific assessment before discussing any next step.",
    accentClass: "assessment-accent-blue",
    fallbackImage: "/campaigns/roof-above.jpg",
    loadingStages: assessmentLoadingStages,
  },
  "for-every-season": {
    slug: "for-every-season",
    kicker: "Your personalized RoofCheck",
    headline: "A personalized look at your New Jersey roof.",
    intro: "We are checking the property first so the questions and result are grounded in your home.",
    accentClass: "assessment-accent-lime",
    fallbackImage: "/campaigns/every-season.jpg",
    loadingStages: assessmentLoadingStages,
  },
};

export function getRoofAssessmentContext(campaign: string | null | undefined) {
  if (campaign && campaign in assessmentContexts) {
    return assessmentContexts[campaign as RoofAssessmentCampaignSlug];
  }
  return assessmentContexts["for-every-season"];
}
