import { describe, expect, it } from "vitest";
import {
  addOnAmountCents,
  defaultAddOnValue,
  defaultPricePerSquareCents,
  defaultValidUntil,
  draftFromRateCard,
  optionTotalCents,
  pickProposalMeasurement,
  proposalTotals,
  shouldAdvanceToProposalSent,
  streetMatchesAddress,
  zipFromAddress,
  type RateCardTier,
} from "./proposals";

describe("proposal pricing", () => {
  it("opens at the middle of the rate card range, rounded to the dollar", () => {
    expect(defaultPricePerSquareCents(80_000, 97_500)).toBe(88_800);
    expect(defaultPricePerSquareCents(95_000, 120_000)).toBe(107_500);
    expect(() => defaultPricePerSquareCents(100, 50)).toThrow();
  });

  it("prices an option by measured squares", () => {
    expect(optionTotalCents(29.6, 65_500)).toBe(1_938_800);
    expect(() => optionTotalCents(0, 65_500)).toThrow();
  });

  it("prices each add-on kind the way rate card adjustments are defined", () => {
    const squares = 25;
    const option = 2_500_000;
    expect(addOnAmountCents({ calculationKind: "flat", unitValue: 650, quantity: 1, included: true }, squares, option)).toBe(65_000);
    expect(addOnAmountCents({ calculationKind: "per_unit", unitValue: 95, quantity: 4, included: true }, squares, option)).toBe(38_000);
    expect(addOnAmountCents({ calculationKind: "per_square", unitValue: 85, quantity: 1, included: true }, squares, option)).toBe(212_500);
    expect(addOnAmountCents({ calculationKind: "percentage", unitValue: 15, quantity: 1, included: true }, squares, option)).toBe(375_000);
  });

  it("totals the chosen option with only the included add-ons", () => {
    expect(proposalTotals({
      roofSquares: 20,
      option: { tierKey: "better", pricePerSquareCents: 100_000 },
      addOns: [
        { calculationKind: "flat", unitValue: 650, quantity: 1, included: true },
        { calculationKind: "per_unit", unitValue: 95, quantity: 4, included: false },
        { calculationKind: "percentage", unitValue: 10, quantity: 1, included: true },
      ],
    })).toEqual({ optionTotalCents: 2_000_000, addOnsTotalCents: 265_000, totalCents: 2_265_000 });
  });

  it("defaults add-on values to the middle of their range", () => {
    expect(defaultAddOnValue(95, 150)).toBe(122.5);
  });

  it("is valid for 30 days", () => {
    expect(defaultValidUntil(new Date("2026-10-13T12:00:00Z"))).toBe("2026-11-12");
  });
});

describe("Roofr address matching", () => {
  it("matches a JobNimbus street and ZIP against a lead address", () => {
    expect(streetMatchesAddress({ jobStreet: "14 Linden Ave", jobZip: "08033", address: "14 Linden Ave, Haddonfield, NJ 08033, USA" })).toBe(true);
    expect(streetMatchesAddress({ jobStreet: "14 Linden Ave.", jobZip: "08033-1234", address: "14 linden ave haddonfield nj 08033" })).toBe(true);
  });

  it("refuses partial or ZIP-less matches", () => {
    expect(streetMatchesAddress({ jobStreet: "14 Linden Ave", jobZip: "08034", address: "14 Linden Ave, Haddonfield, NJ 08033" })).toBe(false);
    expect(streetMatchesAddress({ jobStreet: "140 Linden Ave", jobZip: "08033", address: "14 Linden Ave, Haddonfield, NJ 08033" })).toBe(false);
    expect(streetMatchesAddress({ jobStreet: "14 Linden Ave", jobZip: null, address: "14 Linden Ave, Haddonfield, NJ 08033" })).toBe(false);
    expect(streetMatchesAddress({ jobStreet: "", jobZip: "08033", address: "14 Linden Ave, NJ 08033" })).toBe(false);
  });
});

const tier = (tierKey: RateCardTier["tierKey"], displayOrder: number, low: number, high: number): RateCardTier => ({
  tierKey,
  displayOrder,
  customerName: `CertainTeed ${tierKey}`,
  customerDescription: "Architectural shingle system",
  warrantySummary: "SureStart PLUS",
  differentiators: ["Lifetime limited warranty", 7],
  lowCentsPerSquare: low,
  highCentsPerSquare: high,
  productLineId: tierKey === "good" ? null : `line-${tierKey}`,
  productLineName: `Line ${tierKey}`,
  manufacturerName: "CertainTeed",
});

describe("drafting from the rate card", () => {
  it("copies the three tiers in display order, priced at the middle of each range", () => {
    const draft = draftFromRateCard({
      tiers: [tier("best", 3, 125_000, 165_000), tier("good", 1, 80_000, 97_500), tier("better", 2, 95_000, 120_000)],
      adjustments: [
        { adjustmentCode: "skylight", customerLabel: "Skylight", customerExplanation: "Reflash", calculationKind: "per_unit", lowValue: 1200, highValue: 2500, displayOrder: 7 },
        { adjustmentCode: "decking_sheet", customerLabel: "Decking", customerExplanation: "Replace", calculationKind: "per_unit", lowValue: 95, highValue: 150, displayOrder: 1 },
      ],
    });
    expect(draft.options.map((option) => [option.tier_key, option.display_order, option.price_per_square_cents])).toEqual([
      ["good", 1, 88_800],
      ["better", 2, 107_500],
      ["best", 3, 145_000],
    ]);
    expect(draft.options[0]).toMatchObject({ product_line_id: null, manufacturer_name: null, product_line_name: null });
    expect(draft.options[1]).toMatchObject({ product_line_id: "line-better", manufacturer_name: "CertainTeed" });
    expect(draft.options[0].differentiators).toEqual(["Lifetime limited warranty"]);
    expect(draft.addOns.map((addOn) => [addOn.adjustment_code, addOn.display_order, addOn.unit_value, addOn.included])).toEqual([
      ["decking_sheet", 1, 122.5, false],
      ["skylight", 2, 1850, false],
    ]);
  });

  it("refuses a rate card without exactly one tier of each kind", () => {
    expect(() => draftFromRateCard({ tiers: [tier("good", 1, 1, 2), tier("good", 2, 1, 2), tier("best", 3, 1, 2)], adjustments: [] })).toThrow();
  });
});

describe("choosing the measurement", () => {
  const estimate = { id: "est-1", status: "ready", roofSquares: 28.4 };

  it("prefers a single matched Roofr report over the Google estimate", () => {
    expect(pickProposalMeasurement({ roofrReports: [{ fileJnid: "f1", totalSquares: 29.6, pitch12: 7 }], estimate })).toEqual({
      roofSquares: 29.6,
      measurementSource: "roofr",
      measurementRef: "f1",
      pitch12: 7,
    });
  });

  it("falls back to a ready Google estimate when Roofr is missing or ambiguous", () => {
    const twoReports = [
      { fileJnid: "f1", totalSquares: 29.6, pitch12: 7 },
      { fileJnid: "f2", totalSquares: 31, pitch12: 6 },
    ];
    expect(pickProposalMeasurement({ roofrReports: twoReports, estimate })).toMatchObject({ measurementSource: "google_solar", measurementRef: "est-1", roofSquares: 28.4 });
    expect(pickProposalMeasurement({ roofrReports: [], estimate: { ...estimate, status: "pending" } })).toBeNull();
    expect(pickProposalMeasurement({ roofrReports: [], estimate: null })).toBeNull();
  });
});

describe("lead stage and address helpers", () => {
  it("moves open leads to Proposal sent but leaves won and lost alone", () => {
    expect(shouldAdvanceToProposalSent("estimating")).toBe(true);
    expect(shouldAdvanceToProposalSent("nurture")).toBe(true);
    expect(shouldAdvanceToProposalSent("proposal_sent")).toBe(false);
    expect(shouldAdvanceToProposalSent("won")).toBe(false);
    expect(shouldAdvanceToProposalSent("lost")).toBe(false);
  });

  it("reads the ZIP from the end of an address", () => {
    expect(zipFromAddress("12345 Main St, Haddonfield, NJ 08033-1234")).toBe("08033");
    expect(zipFromAddress("14 Linden Ave, Haddonfield, NJ")).toBeNull();
  });
});
