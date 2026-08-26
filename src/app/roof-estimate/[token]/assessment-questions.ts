import type { RoofAssessmentQuestionId, RoofAssessmentResponses } from "@/domain/roof-assessment";

export type AssessmentOption<T extends string = string> = {
  value: T;
  label: string;
};

export const reasonOptions: AssessmentOption<RoofAssessmentResponses["reason"]>[] = [
  {value: "roof_age", label: "Roof is getting old"},
  {value: "active_leak", label: "I noticed a leak"},
  {value: "damaged_shingles", label: "Missing or damaged shingles"},
  {value: "storm_damage", label: "Storm or wind damage"},
  {value: "transaction", label: "Selling or buying the home"},
  {value: "planning", label: "Just planning ahead"},
  {value: "known_replacement", label: "I already know it needs replacement"},
];

export const roofAgeOptions: AssessmentOption<RoofAssessmentResponses["roofAge"]>[] = [
  {value: "under_5", label: "Under 5 years"},
  {value: "5_10", label: "5–10 years"},
  {value: "10_15", label: "10–15 years"},
  {value: "15_20", label: "15–20 years"},
  {value: "20_plus", label: "20+ years"},
  {value: "unknown", label: "No idea"},
];

export const conditionOptions: AssessmentOption<RoofAssessmentResponses["conditionSignals"][number]>[] = [
  {value: "missing_shingles", label: "Shingles missing"},
  {value: "curling_or_cracking", label: "Shingles curling or cracking"},
  {value: "granules", label: "Granules in gutters"},
  {value: "water_stains", label: "Interior water stains"},
  {value: "active_leak", label: "Active leak"},
  {value: "sagging", label: "Sagging"},
  {value: "moss_or_algae", label: "Moss or algae"},
  {value: "nothing_obvious", label: "Nothing obvious"},
  {value: "unsure", label: "Not sure"},
];

export const storyOptions: AssessmentOption<RoofAssessmentResponses["stories"]>[] = [
  {value: "one", label: "One-story home"},
  {value: "two", label: "Two-story home"},
  {value: "three_plus", label: "Three+ stories"},
  {value: "unknown", label: "Not sure"},
];

export const complexityOptions: AssessmentOption<RoofAssessmentResponses["complexityFeatures"][number]>[] = [
  {value: "garage", label: "Garage"},
  {value: "porch", label: "Porch roof"},
  {value: "addition", label: "Addition"},
  {value: "flat_section", label: "Flat roof section"},
  {value: "multiple_levels", label: "Multiple roof levels"},
  {value: "none_or_unsure", label: "None or not sure"},
];

export const priorityOptions: AssessmentOption<RoofAssessmentResponses["priority"]>[] = [
  {value: "reasonable_cost", label: "Best value over time"},
  {value: "long_warranty", label: "Strongest long-term warranty"},
  {value: "appearance", label: "A roof that fits the home"},
  {value: "speed", label: "A clear, efficient installation"},
  {value: "financing", label: "Flexible payment planning"},
  {value: "understand_options", label: "A recommendation I can trust"},
];

export const timelineOptions: AssessmentOption<RoofAssessmentResponses["timeline"]>[] = [
  {value: "asap", label: "ASAP"},
  {value: "within_month", label: "Within a month"},
  {value: "this_season", label: "This season"},
  {value: "this_year", label: "Sometime this year"},
  {value: "researching", label: "I'm just researching"},
];

export const ownershipOptions: AssessmentOption<RoofAssessmentResponses["ownership"]>[] = [
  {value: "owner", label: "Yes, this is my home"},
  {value: "buying", label: "I'm buying it"},
  {value: "manager", label: "I manage it for someone"},
  {value: "not_owner", label: "No"},
];

export const assessmentQuestionTitles = {
  reason: "What made you check your roof today?",
  roofAge: "About how old do you think the roof is?",
  conditionSignals: "Have you noticed any of these?",
  roofVisibility: "Can you see your roof from the ground?",
  stories: "Quick property check",
  complexityFeatures: "Any sections like these?",
  priority: "What would make the project feel like the right decision?",
  timeline: "How soon would a professional review be useful?",
  ownership: "What is your role with this property?",
} as const satisfies Record<RoofAssessmentQuestionId, string>;
