import {z} from "zod";

export const roofPricingTierKeySchema = z.enum(["good", "better", "best"]);
export type RoofPricingTierKey = z.infer<typeof roofPricingTierKeySchema>;

export const roofPricingTierRateSchema = z.object({
  tierKey: roofPricingTierKeySchema,
  displayOrder: z.number().int().min(1).max(3),
  customerName: z.string().min(1),
  customerDescription: z.string().min(1),
  warrantySummary: z.string().min(1),
  differentiators: z.array(z.string().min(1)).min(1),
  lowCentsPerSquare: z.number().int().positive(),
  highCentsPerSquare: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  if (value.highCentsPerSquare < value.lowCentsPerSquare) {
    context.addIssue({code:"custom",path:["highCentsPerSquare"],message:"High rate must not be lower than low rate"});
  }
});
export type RoofPricingTierRate = z.infer<typeof roofPricingTierRateSchema>;

export const roofPricingPackageSchema = roofPricingTierRateSchema.extend({
  recommended: z.boolean(),
  measuredRoofSquares: z.number().positive(),
  rangeLowCents: z.number().int().positive(),
  rangeHighCents: z.number().int().positive(),
  pricingVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if (value.rangeHighCents < value.rangeLowCents) {
    context.addIssue({code:"custom",path:["rangeHighCents"],message:"High range must not be lower than low range"});
  }
  if (value.recommended !== (value.tierKey === "better")) {
    context.addIssue({code:"custom",path:["recommended"],message:"Only Better is recommended"});
  }
});
export type RoofPricingPackage = z.infer<typeof roofPricingPackageSchema>;

export const roofPricingPackagesSchema = z.array(roofPricingPackageSchema).length(3).superRefine((packages, context) => {
  const expected: RoofPricingTierKey[] = ["good", "better", "best"];
  packages.forEach((item, index) => {
    if (item.tierKey !== expected[index] || item.displayOrder !== index + 1) {
      context.addIssue({code:"custom",path:[index],message:"Packages must be ordered Good, Better, Best"});
    }
  });
  if (new Set(packages.map((item) => item.tierKey)).size !== 3) {
    context.addIssue({code:"custom",message:"Packages must contain one of each tier"});
  }
});

export const roofPricingAdjustmentDisclosureSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  explanation: z.string().min(1),
  calculationKind: z.enum(["percentage", "flat", "per_square", "per_unit"]),
  lowValue: z.coerce.number().nonnegative(),
  highValue: z.coerce.number().nonnegative(),
  displayOrder: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  if (value.highValue < value.lowValue) {
    context.addIssue({code:"custom",path:["highValue"],message:"High adjustment must not be lower than low adjustment"});
  }
});
export type RoofPricingAdjustmentDisclosure = z.infer<typeof roofPricingAdjustmentDisclosureSchema>;

export type FinalizedRoofEstimate = {
  roofSquares: number;
  packages: RoofPricingPackage[];
  adjustments: RoofPricingAdjustmentDisclosure[];
  primary: RoofPricingPackage;
  pricingVersion: string;
  generatedAt: string;
};

export function calculateRoofPricingPackages(
  roofSquares: number,
  rawTiers: readonly RoofPricingTierRate[],
  pricingVersion: string,
  generatedAt: string,
) {
  if (!Number.isFinite(roofSquares) || roofSquares <= 0) {
    throw new Error("Roof squares must be a finite positive number");
  }
  const tiers = z.array(roofPricingTierRateSchema).length(3).parse(rawTiers);
  const packages = roofPricingPackagesSchema.parse(tiers.map((tier) => ({
    ...tier,
    recommended: tier.tierKey === "better",
    measuredRoofSquares: roofSquares,
    rangeLowCents: Math.round(roofSquares * tier.lowCentsPerSquare),
    rangeHighCents: Math.round(roofSquares * tier.highCentsPerSquare),
    pricingVersion,
    generatedAt,
  })));
  return {packages, primary: packages[1]};
}

const money = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(cents / 100);

const packageLine = (item: RoofPricingPackage) =>
  `${item.customerName}: ${money(item.rangeLowCents)}–${money(item.rangeHighCents)}`;

export function composeEstimateEmail(input: {
  name: string;
  resultUrl: string;
  estimate: FinalizedRoofEstimate;
}) {
  const disclosures = input.estimate.adjustments.length > 0
    ? `\n\nPossible field-confirmed adjustments:\n${input.estimate.adjustments.map((item) => `• ${item.label}: ${item.explanation}`).join("\n")}`
    : "";
  return {
    subject: "Your personalized roof pricing options",
    body: `Hi ${input.name},\n\nYour preliminary options based on approximately ${input.estimate.roofSquares.toFixed(1)} measured roofing squares are:\n\n${input.estimate.packages.map(packageLine).join("\n")}${disclosures}\n\nThese are preliminary planning ranges. A field inspection confirms tear-off layers, decking, access, flashing, skylights, scope, and final pricing.\n\nReview your property assessment: ${input.resultUrl}`,
  };
}

export function composeEstimateSms(input: {
  name: string;
  resultUrl: string;
  estimate: FinalizedRoofEstimate;
}) {
  return `Hi ${input.name}, your preliminary roof options: ${input.estimate.packages.map(packageLine).join(" | ")}. Field inspection confirms final scope and pricing. ${input.resultUrl}`;
}
