import type {CalculationState, RoofAssessmentResponses} from "@/domain/roof-assessment";
import type {ActiveSquaresTier} from "@/domain/roof-drawing";
import {
  calculateRoofPricingPackages,
  type RoofPricingAdjustmentDisclosure,
  type RoofPricingTierRate,
} from "@/domain/roof-pricing";

// Sandbox copy of the All Season NJ 2026 rate card from
// scripts/seed-all-season-roof-pricing.mjs. Live estimates price in SQL
// (finalize_roof_estimate_packages) from the database rate card; this copy
// only prices the staff measuring page (/roof-measure) and the dev sandbox
// preview. It never reaches a customer estimate.
export const SANDBOX_PRICING_VERSION = "all-season-nj-2026-v1 (sandbox copy)";

export const sandboxTierRates: RoofPricingTierRate[] = [
  {tierKey: "good", displayOrder: 1, customerName: "CertainTeed Patriot", customerDescription: "A complete CertainTeed roof system with a dual-layer, wood-shake-look shingle.", warrantySummary: "CertainTeed lifetime limited warranty with 10-year SureStart protection.", differentiators: ["Dual-layer architectural shingle", "CertainTeed starter and ridge for 130 mph wind rating", "10-year SureStart protection"], lowCentsPerSquare: 80_000, highCentsPerSquare: 97_500, manufacturerName: "CertainTeed", productLineName: "Patriot"},
  {tierKey: "better", displayOrder: 2, customerName: "CertainTeed Landmark", customerDescription: "CertainTeed's best-selling architectural shingle, installed as a full Integrity Roof System.", warrantySummary: "SureStart PLUS 5-Star: 50 years non-prorated material and labor, plus 25 years of CertainTeed-backed workmanship coverage.", differentiators: ["Installed by a CertainTeed SELECT ShingleMaster", "Integrity Roof System with WinterGuard ice and water protection", "Enhanced dimensional appearance"], lowCentsPerSquare: 95_000, highCentsPerSquare: 120_000, manufacturerName: "CertainTeed", productLineName: "Landmark"},
  {tierKey: "best", displayOrder: 3, customerName: "CertainTeed Landmark PRO", customerDescription: "CertainTeed's heavier Landmark PRO shingle with Max Def colour and impact resistance.", warrantySummary: "SureStart PLUS 5-Star: 50 years non-prorated material and labor, plus 25 years of CertainTeed-backed workmanship coverage.", differentiators: ["Heavier dual-layer shingle", "Max Def colour blends", "UL 2218 Class 3 impact rating"], lowCentsPerSquare: 125_000, highCentsPerSquare: 165_000, manufacturerName: "CertainTeed", productLineName: "Landmark PRO"},
];

export const sandboxAdjustments: RoofPricingAdjustmentDisclosure[] = [
  {code: "pitch_8_10", label: "8/12–10/12 roof pitch", explanation: "Steeper roof access may add labor and safety requirements.", calculationKind: "percentage", lowValue: 15, highValue: 15, displayOrder: 1},
  {code: "steep_or_third_story", label: "Above 10/12 pitch or third-story access", explanation: "Very steep or elevated work may add labor, access, and safety requirements.", calculationKind: "percentage", lowValue: 25, highValue: 35, displayOrder: 2},
];

export type StoryAnswer = RoofAssessmentResponses["stories"];

/** Rate-card surcharges the measurement would trigger. Live pricing lists them as disclosures without adding them. */
export function triggeredAdjustments(input: {predominantPitchRise: number | null; maxPitchRise: number | null; stories: StoryAnswer}) {
  const codes: string[] = [];
  const steep = (input.maxPitchRise ?? 0) > 10 || input.stories === "three_plus";
  if (steep) codes.push("steep_or_third_story");
  else if ((input.predominantPitchRise ?? 0) >= 8) codes.push("pitch_8_10");
  return sandboxAdjustments.filter((item) => codes.includes(item.code));
}

export function priceSquares(squares: number, generatedAt: string) {
  const rounded = Math.round(squares * 10) / 10;
  return {roofSquares: rounded, ...calculateRoofPricingPackages(rounded, sandboxTierRates, SANDBOX_PRICING_VERSION, generatedAt)};
}

export function withPercentAdjustments(cents: number, adjustments: RoofPricingAdjustmentDisclosure[], end: "low" | "high") {
  const percent = adjustments
    .filter((item) => item.calculationKind === "percentage")
    .reduce((sum, item) => sum + (end === "low" ? item.lowValue : item.highValue), 0);
  return Math.round(cents * (1 + percent / 100));
}

// ---------------------------------------------------------------------------
// Handoff from the measuring page to the dev assessment sandbox (same browser
// tab session only; nothing leaves the browser).

export const MEASUREMENT_HANDOFF_KEY = "piw.devRoofMeasurement.v1";

export type MeasurementHandoff = {
  address: string | null;
  squares: number;
  tier: ActiveSquaresTier;
  stories: StoryAnswer;
  predominantPitchRise: number | null;
  maxPitchRise: number | null;
  savedAt: string;
};

export function saveMeasurementHandoff(handoff: MeasurementHandoff, storage: Storage = window.sessionStorage) {
  storage.setItem(MEASUREMENT_HANDOFF_KEY, JSON.stringify(handoff));
}

export function clearMeasurementHandoff(storage: Storage = window.sessionStorage) {
  storage.removeItem(MEASUREMENT_HANDOFF_KEY);
}

export function readMeasurementHandoff(storage: Storage | undefined): MeasurementHandoff | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(MEASUREMENT_HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as MeasurementHandoff;
    return typeof value.squares === "number" && value.squares > 0 ? value : null;
  } catch {
    return null;
  }
}

/** A ready calculation for the sandbox's result screen, priced from the measurement. */
export function calculationFromHandoff(handoff: MeasurementHandoff): CalculationState {
  const generatedAt = handoff.savedAt;
  const priced = priceSquares(handoff.squares, generatedAt);
  return {
    status: "ready",
    source: "google",
    lowCents: priced.primary.rangeLowCents,
    highCents: priced.primary.rangeHighCents,
    roofSquares: priced.roofSquares,
    generatedAt,
    pricingVersion: SANDBOX_PRICING_VERSION,
    packages: priced.packages,
    adjustments: triggeredAdjustments(handoff),
  };
}
