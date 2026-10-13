import { z } from "zod";
import type { leadStageSchema } from "./crm";
import { roofPricingTierKeySchema, type RoofPricingTierKey } from "./roof-pricing";

// A proposal is the firm offer that follows the preliminary range. Prices are
// whole dollars per square, defaulted from the rate card and adjustable by the
// rep; add-ons use the same calculation kinds as rate card adjustments.

export const proposalStatusSchema = z.enum(["draft", "sent", "accepted", "declined", "void"]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const measurementSourceSchema = z.enum(["google_solar", "roofr", "manual"]);
export type MeasurementSource = z.infer<typeof measurementSourceSchema>;

export const addOnKindSchema = z.enum(["flat", "per_unit", "per_square", "percentage"]);
export type AddOnKind = z.infer<typeof addOnKindSchema>;

export type ProposalOptionPrice = {
  tierKey: RoofPricingTierKey;
  pricePerSquareCents: number;
};

export type ProposalAddOnPrice = {
  calculationKind: AddOnKind;
  unitValue: number;
  quantity: number;
  included: boolean;
};

const DEFAULT_VALID_DAYS = 30;

// The rate card carries a planning range; a firm proposal opens at the middle
// of it, rounded to the dollar.
export function defaultPricePerSquareCents(lowCents: number, highCents: number): number {
  if (!Number.isInteger(lowCents) || !Number.isInteger(highCents) || lowCents <= 0 || highCents < lowCents) {
    throw new Error("Rate card range must be positive whole cents with high >= low");
  }
  return Math.round((lowCents + highCents) / 2 / 100) * 100;
}

export function defaultAddOnValue(low: number, high: number): number {
  return Math.round(((low + high) / 2) * 100) / 100;
}

export function optionTotalCents(roofSquares: number, pricePerSquareCents: number): number {
  assertSquares(roofSquares);
  return Math.round(roofSquares * pricePerSquareCents);
}

export function addOnAmountCents(addOn: ProposalAddOnPrice, roofSquares: number, optionTotal: number): number {
  assertSquares(roofSquares);
  if (addOn.unitValue < 0 || addOn.quantity < 0) throw new Error("Add-on values must not be negative");
  switch (addOn.calculationKind) {
    case "flat":
      return Math.round(addOn.unitValue * 100);
    case "per_unit":
      return Math.round(addOn.unitValue * addOn.quantity * 100);
    case "per_square":
      return Math.round(addOn.unitValue * roofSquares * 100);
    case "percentage":
      return Math.round((optionTotal * addOn.unitValue) / 100);
  }
}

export type ProposalTotals = {
  optionTotalCents: number;
  addOnsTotalCents: number;
  totalCents: number;
};

export function proposalTotals(input: {
  roofSquares: number;
  option: ProposalOptionPrice;
  addOns: ProposalAddOnPrice[];
}): ProposalTotals {
  const option = optionTotalCents(input.roofSquares, input.option.pricePerSquareCents);
  const addOns = input.addOns
    .filter((addOn) => addOn.included)
    .reduce((sum, addOn) => sum + addOnAmountCents(addOn, input.roofSquares, option), 0);
  return { optionTotalCents: option, addOnsTotalCents: addOns, totalCents: option + addOns };
}

export function defaultValidUntil(now: Date): string {
  const until = new Date(now.getTime() + DEFAULT_VALID_DAYS * 24 * 60 * 60 * 1_000);
  return until.toISOString().slice(0, 10);
}

// Roofr reports live on JobNimbus jobs; PIW leads carry an address. A report
// is used only when exactly one job shares the lead's street line and ZIP.
export function normalizeStreet(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function streetMatchesAddress(input: {
  jobStreet: string | null;
  jobZip: string | null;
  address: string;
}): boolean {
  const street = normalizeStreet(input.jobStreet);
  const zip = (input.jobZip ?? "").trim().slice(0, 5);
  if (street.length < 4 || !/^\d{5}$/.test(zip)) return false;
  const address = normalizeStreet(input.address);
  return address.startsWith(street) && address.includes(zip);
}

export const proposalMeasurementInputSchema = z.object({
  roofSquares: z.coerce.number().positive().max(99_999_999.99),
  measurementSource: measurementSourceSchema,
  measurementRef: z.string().trim().min(1).max(200).nullable(),
  pitch12: z.coerce.number().min(0).max(30).nullable(),
  stories: z.coerce.number().int().min(1).max(6).nullable(),
  layersToRemove: z.coerce.number().int().min(0).max(4).nullable(),
});

export const proposalTierKeySchema = roofPricingTierKeySchema;

export type ProposalMeasurement = {
  roofSquares: number;
  measurementSource: MeasurementSource;
  measurementRef: string | null;
  pitch12: number | null;
};

// Roofr is a measured report, so it wins over the Google Solar estimate. A
// Roofr report is used only when exactly one JobNimbus job matches the lead.
export function pickProposalMeasurement(input: {
  roofrReports: { fileJnid: string; totalSquares: number; pitch12: number | null }[];
  estimate: { id: string; status: string; roofSquares: number | null } | null;
}): ProposalMeasurement | null {
  if (input.roofrReports.length === 1) {
    const [report] = input.roofrReports;
    return {
      roofSquares: report.totalSquares,
      measurementSource: "roofr",
      measurementRef: report.fileJnid,
      pitch12: report.pitch12,
    };
  }
  const estimate = input.estimate;
  if (estimate?.status === "ready" && estimate.roofSquares && estimate.roofSquares > 0) {
    return {
      roofSquares: estimate.roofSquares,
      measurementSource: "google_solar",
      measurementRef: estimate.id,
      pitch12: null,
    };
  }
  return null;
}

export type RateCardTier = {
  tierKey: RoofPricingTierKey;
  displayOrder: number;
  customerName: string;
  customerDescription: string;
  warrantySummary: string;
  differentiators: unknown;
  lowCentsPerSquare: number;
  highCentsPerSquare: number;
  productLineId: string | null;
  productLineName: string | null;
  manufacturerName: string | null;
};

export type RateCardAdjustment = {
  adjustmentCode: string;
  customerLabel: string;
  customerExplanation: string;
  calculationKind: AddOnKind;
  lowValue: number;
  highValue: number;
  displayOrder: number;
};

export type ProposalOptionDraft = {
  tier_key: RoofPricingTierKey;
  display_order: number;
  product_line_id: string | null;
  manufacturer_name: string | null;
  product_line_name: string | null;
  customer_name: string;
  customer_description: string;
  warranty_summary: string;
  differentiators: string[];
  price_per_square_cents: number;
};

export type ProposalAddOnDraft = {
  adjustment_code: string;
  label: string;
  explanation: string;
  calculation_kind: AddOnKind;
  unit_value: number;
  quantity: number;
  included: boolean;
  display_order: number;
};

// Options and add-ons are copied from the rate card so the proposal keeps
// what was offered after the rate card changes.
export function draftFromRateCard(input: {
  tiers: RateCardTier[];
  adjustments: RateCardAdjustment[];
}): { options: ProposalOptionDraft[]; addOns: ProposalAddOnDraft[] } {
  const keys = new Set(input.tiers.map((tier) => tier.tierKey));
  if (input.tiers.length !== 3 || keys.size !== 3) {
    throw new Error("The active rate card needs exactly one Good, Better and Best tier");
  }
  const options = [...input.tiers]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((tier, index) => ({
      tier_key: tier.tierKey,
      display_order: index + 1,
      product_line_id: tier.productLineId,
      manufacturer_name: tier.productLineId ? tier.manufacturerName : null,
      product_line_name: tier.productLineId ? tier.productLineName : null,
      customer_name: tier.customerName,
      customer_description: tier.customerDescription,
      warranty_summary: tier.warrantySummary,
      differentiators: Array.isArray(tier.differentiators)
        ? tier.differentiators.filter((item): item is string => typeof item === "string")
        : [],
      price_per_square_cents: defaultPricePerSquareCents(tier.lowCentsPerSquare, tier.highCentsPerSquare),
    }));
  const addOns = [...input.adjustments]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((adjustment, index) => ({
      adjustment_code: adjustment.adjustmentCode,
      label: adjustment.customerLabel,
      explanation: adjustment.customerExplanation,
      calculation_kind: adjustment.calculationKind,
      unit_value: defaultAddOnValue(adjustment.lowValue, adjustment.highValue),
      quantity: 1,
      included: false,
      display_order: index + 1,
    }));
  return { options, addOns };
}

type LeadStage = z.infer<typeof leadStageSchema>;

// Sending a proposal moves an open lead to Proposal sent; it never pulls a
// won or lost lead back into the pipeline.
const ADVANCES_TO_PROPOSAL_SENT: ReadonlySet<LeadStage> = new Set([
  "new",
  "contacting",
  "appointment_set",
  "estimating",
  "nurture",
]);

export function shouldAdvanceToProposalSent(stage: LeadStage): boolean {
  return ADVANCES_TO_PROPOSAL_SENT.has(stage);
}

// Pulls the ZIP from a free-form lead address (the last five-digit group).
export function zipFromAddress(address: string): string | null {
  const matches = address.match(/\b\d{5}(?:-\d{4})?\b/g);
  return matches ? matches[matches.length - 1].slice(0, 5) : null;
}

function assertSquares(roofSquares: number) {
  if (!Number.isFinite(roofSquares) || roofSquares <= 0) throw new Error("Roof squares must be positive");
}
