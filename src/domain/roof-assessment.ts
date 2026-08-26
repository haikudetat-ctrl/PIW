import { z } from "zod";

export const ROOF_ASSESSMENT_VERSION = "roof-check-v1" as const;

const conditionSignalSchema = z.enum([
  "missing_shingles",
  "curling_or_cracking",
  "granules",
  "water_stains",
  "active_leak",
  "sagging",
  "moss_or_algae",
  "nothing_obvious",
  "unsure",
]);

const complexityFeatureSchema = z.enum([
  "garage",
  "porch",
  "addition",
  "flat_section",
  "multiple_levels",
  "none_or_unsure",
]);

export const roofAssessmentResponsesSchema = z.object({
  reason: z.enum([
    "roof_age",
    "active_leak",
    "damaged_shingles",
    "storm_damage",
    "transaction",
    "planning",
    "known_replacement",
  ]),
  roofAge: z.enum(["under_5", "5_10", "10_15", "15_20", "20_plus", "unknown"]),
  conditionSignals: z.array(conditionSignalSchema).min(1),
  roofVisible: z.enum(["yes", "no"]),
  visibleCondition: z.enum(["healthy", "moderate_wear", "heavy_wear", "not_answered"]),
  stories: z.enum(["one", "two", "three_plus", "unknown"]),
  complexityFeatures: z.array(complexityFeatureSchema).min(1),
  priority: z.enum([
    "reasonable_cost",
    "long_warranty",
    "appearance",
    "speed",
    "financing",
    "understand_options",
  ]),
  timeline: z.enum(["asap", "within_month", "this_season", "this_year", "researching"]),
  ownership: z.enum(["owner", "buying", "manager", "not_owner"]),
}).superRefine((responses, context) => {
  const exclusiveCondition = responses.conditionSignals.find(
    (signal) => signal === "nothing_obvious" || signal === "unsure",
  );
  if (exclusiveCondition && responses.conditionSignals.length > 1) {
    context.addIssue({
      code: "custom",
      path: ["conditionSignals"],
      message: "Nothing obvious and unsure cannot be combined with other condition signals",
    });
  }

  if (
    responses.complexityFeatures.includes("none_or_unsure") &&
    responses.complexityFeatures.length > 1
  ) {
    context.addIssue({
      code: "custom",
      path: ["complexityFeatures"],
      message: "None or unsure cannot be combined with other roof features",
    });
  }

  if (responses.roofVisible === "no" && responses.visibleCondition !== "not_answered") {
    context.addIssue({
      code: "custom",
      path: ["visibleCondition"],
      message: "Visible condition must be skipped when the roof is not visible",
    });
  }

  if (responses.roofVisible === "yes" && responses.visibleCondition === "not_answered") {
    context.addIssue({
      code: "custom",
      path: ["visibleCondition"],
      message: "Visible condition is required when the roof is visible",
    });
  }
});

export type RoofAssessmentResponses = z.infer<typeof roofAssessmentResponsesSchema>;
export type RoofAssessmentRecommendation =
  | "monitor_or_repair"
  | "professional_inspection"
  | "replacement_may_make_sense";

export type RoofAssessmentScores = {
  need: number;
  intent: number;
  urgency: number;
  propertyFit: number;
  engagement: number;
};

const needWeights = {
  reason: {
    roof_age: 2,
    active_leak: 3,
    damaged_shingles: 2,
    storm_damage: 2,
    transaction: 1,
    planning: 0,
    known_replacement: 4,
  },
  roofAge: {
    under_5: 0,
    "5_10": 1,
    "10_15": 2,
    "15_20": 4,
    "20_plus": 6,
    unknown: 1,
  },
  condition: {
    missing_shingles: 2,
    curling_or_cracking: 2,
    granules: 1,
    water_stains: 2,
    active_leak: 3,
    sagging: 3,
    moss_or_algae: 1,
    nothing_obvious: 0,
    unsure: 0,
  },
  visibleCondition: {
    healthy: 0,
    moderate_wear: 1,
    heavy_wear: 3,
    not_answered: 0,
  },
} as const;

function total(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

export function calculateRoofAssessment(
  input: RoofAssessmentResponses,
): { recommendation: RoofAssessmentRecommendation; scores: RoofAssessmentScores } {
  const responses = roofAssessmentResponsesSchema.parse(input);
  const need =
    needWeights.reason[responses.reason] +
    needWeights.roofAge[responses.roofAge] +
    needWeights.visibleCondition[responses.visibleCondition] +
    total(responses.conditionSignals.map((signal) => needWeights.condition[signal]));

  const urgency =
    (responses.reason === "active_leak" ? 2 : responses.reason === "storm_damage" ? 1 : 0) +
    total(responses.conditionSignals.map((signal) => {
      if (signal === "active_leak") return 2;
      if (signal === "sagging") return 3;
      if (signal === "water_stains") return 1;
      return 0;
    })) +
    (responses.timeline === "asap" ? 2 : responses.timeline === "within_month" ? 1 : 0);

  const intent =
    (responses.reason === "known_replacement" ? 3 : responses.reason === "transaction" ? 1 : 0) +
    (responses.timeline === "asap" || responses.timeline === "within_month"
      ? 2
      : responses.timeline === "this_season"
        ? 1
        : 0) +
    (responses.priority === "financing" || responses.priority === "speed" ? 1 : 0);

  const propertyFit =
    (responses.ownership === "owner" ? 2 : responses.ownership === "buying" ? 1 : 0) +
    (responses.stories === "unknown" ? 0 : 1);

  const engagement =
    (responses.roofAge === "unknown" ? 0 : 1) +
    (responses.conditionSignals.includes("unsure") ? 0 : 1) +
    (responses.visibleCondition === "not_answered" ? 0 : 1);

  const safetySignal = responses.conditionSignals.some(
    (signal) => signal === "sagging" || signal === "active_leak",
  );
  const recommendation: RoofAssessmentRecommendation =
    need >= 11
      ? "replacement_may_make_sense"
      : need >= 4 || safetySignal
        ? "professional_inspection"
        : "monitor_or_repair";

  return {
    recommendation,
    scores: { need, intent, urgency, propertyFit, engagement },
  };
}
