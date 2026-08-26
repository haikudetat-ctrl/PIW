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

export const roofAssessmentResponsesBaseSchema = z.object({
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
}).strict();

function validateResponseRelationships(
  responses: Partial<z.infer<typeof roofAssessmentResponsesBaseSchema>>,
  context: z.RefinementCtx,
) {
  const exclusiveCondition = responses.conditionSignals?.find(
    (signal) => signal === "nothing_obvious" || signal === "unsure",
  );
  if (exclusiveCondition && responses.conditionSignals && responses.conditionSignals.length > 1) {
    context.addIssue({
      code: "custom",
      path: ["conditionSignals"],
      message: "Nothing obvious and unsure cannot be combined with other condition signals",
    });
  }

  if (
    responses.complexityFeatures?.includes("none_or_unsure") &&
    responses.complexityFeatures.length > 1
  ) {
    context.addIssue({
      code: "custom",
      path: ["complexityFeatures"],
      message: "None or unsure cannot be combined with other roof features",
    });
  }

  if (
    responses.roofVisible === "no" &&
    responses.visibleCondition !== undefined &&
    responses.visibleCondition !== "not_answered"
  ) {
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
}

export const roofAssessmentResponsesSchema = roofAssessmentResponsesBaseSchema
  .superRefine(validateResponseRelationships);

export const roofAssessmentProgressSchema = roofAssessmentResponsesBaseSchema
  .partial()
  .strict()
  .superRefine(validateResponseRelationships);

export type RoofAssessmentResponses = z.infer<typeof roofAssessmentResponsesSchema>;

export const roofAssessmentQuestionSteps = [
  {id: "reason", responseKeys: ["reason"]},
  {id: "roofAge", responseKeys: ["roofAge"]},
  {id: "conditionSignals", responseKeys: ["conditionSignals"]},
  {id: "roofVisibility", responseKeys: ["roofVisible", "visibleCondition"]},
  {id: "stories", responseKeys: ["stories"]},
  {id: "complexityFeatures", responseKeys: ["complexityFeatures"]},
  {id: "priority", responseKeys: ["priority"]},
  {id: "timeline", responseKeys: ["timeline"]},
  {id: "ownership", responseKeys: ["ownership"]},
] as const satisfies readonly {
  id: string;
  responseKeys: readonly (keyof RoofAssessmentResponses)[];
}[];

export type RoofAssessmentQuestionStep = (typeof roofAssessmentQuestionSteps)[number];
export type RoofAssessmentQuestionId = RoofAssessmentQuestionStep["id"];

export const roofAssessmentQuestionIds = roofAssessmentQuestionSteps.map(
  (step) => step.id,
) as [RoofAssessmentQuestionId, ...RoofAssessmentQuestionId[]];

export function isRoofAssessmentStepAnswered(
  stepIndex: number,
  responses: Partial<RoofAssessmentResponses>,
) {
  const step = roofAssessmentQuestionSteps[stepIndex];
  if (!step) return false;
  if (step.id === "roofVisibility") {
    return responses.roofVisible === "no"
      ? responses.visibleCondition === "not_answered"
      : responses.roofVisible === "yes" &&
          Boolean(responses.visibleCondition && responses.visibleCondition !== "not_answered");
  }
  return step.responseKeys.every((key) => {
    const value = responses[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
}

export function roofAssessmentStepResponsePatch(
  stepIndex: number,
  responses: Partial<RoofAssessmentResponses>,
): Partial<RoofAssessmentResponses> {
  const step = roofAssessmentQuestionSteps[stepIndex];
  if (!step) return {};
  return Object.fromEntries(
    step.responseKeys
      .filter((key) => responses[key] !== undefined)
      .map((key) => [key, responses[key]]),
  ) as Partial<RoofAssessmentResponses>;
}
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

const pendingCalculationStateSchema = z.object({
  status: z.literal("pending"),
}).strict();

const reviewRequiredCalculationStateSchema = z.object({
  status: z.literal("review_required"),
  reason: z.enum(["unavailable", "low_confidence", "property_not_supported"]).optional(),
}).strict();

const readyCalculationStateSchema = z.object({
  status: z.literal("ready"),
  source: z.literal("google"),
  lowCents: z.number().int().nonnegative(),
  highCents: z.number().int().positive(),
  roofSquares: z.number().positive(),
  generatedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if (value.highCents <= value.lowCents) {
    context.addIssue({
      code: "custom",
      path: ["highCents"],
      message: "The high end of a calculation range must exceed the low end",
    });
  }
});

export const calculationStateSchema = z.union([
  pendingCalculationStateSchema,
  reviewRequiredCalculationStateSchema,
  readyCalculationStateSchema,
]);

export type CalculationState = z.infer<typeof calculationStateSchema>;

export type RoofAssessmentProgressSignals = {
  complete: boolean;
  highIntent: boolean;
  scores: RoofAssessmentScores;
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

function calculateScores(
  responses: Partial<RoofAssessmentResponses>,
): RoofAssessmentScores {
  const conditionSignals = responses.conditionSignals ?? [];
  const need =
    (responses.reason ? needWeights.reason[responses.reason] : 0) +
    (responses.roofAge ? needWeights.roofAge[responses.roofAge] : 0) +
    (responses.visibleCondition
      ? needWeights.visibleCondition[responses.visibleCondition]
      : 0) +
    total(conditionSignals.map((signal) => needWeights.condition[signal]));

  const urgency =
    (responses.reason === "active_leak" ? 2 : responses.reason === "storm_damage" ? 1 : 0) +
    total(conditionSignals.map((signal) => {
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
    (responses.stories && responses.stories !== "unknown" ? 1 : 0);

  const engagement =
    (responses.roofAge && responses.roofAge !== "unknown" ? 1 : 0) +
    (responses.conditionSignals && !responses.conditionSignals.includes("unsure") ? 1 : 0) +
    (responses.visibleCondition && responses.visibleCondition !== "not_answered" ? 1 : 0);

  return {need, intent, urgency, propertyFit, engagement};
}

export function calculateProgressSignals(
  input: Partial<RoofAssessmentResponses>,
): RoofAssessmentProgressSignals {
  const responses = roofAssessmentProgressSchema.parse(input);
  const scores = calculateScores(responses);
  return {
    complete: roofAssessmentResponsesSchema.safeParse(responses).success,
    highIntent: scores.intent >= 3 || scores.urgency >= 3,
    scores,
  };
}

export function calculateRoofAssessment(
  input: RoofAssessmentResponses,
): { recommendation: RoofAssessmentRecommendation; scores: RoofAssessmentScores } {
  const responses = roofAssessmentResponsesSchema.parse(input);
  const scores = calculateScores(responses);
  const {need} = scores;

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
    scores,
  };
}
