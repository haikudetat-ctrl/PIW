// @vitest-environment node
import { renderToBuffer } from "@react-pdf/renderer";
import { writeFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { ProposalDocument, type ProposalDocumentProps } from "./proposal-document";

const props: ProposalDocumentProps = {
  companyName: "All Season Roofing",
  proposalNumber: "7648B78D-v2",
  issuedOn: new Date("2026-10-13T15:00:00Z"),
  validUntil: "2026-11-12",
  status: "sent",
  customerName: "Dana Whitfield",
  propertyAddress: "14 Linden Ave, Haddonfield, NJ 08033",
  roofSquares: 29.6,
  measurementSource: "roofr",
  pitch12: 7,
  recommendedTier: "better",
  options: [
    { tierKey: "good", customerName: "CertainTeed Patriot", manufacturerName: "CertainTeed", productLineName: "Patriot", customerDescription: "Dependable architectural shingle.", warrantySummary: "SureStart protection", differentiators: ["Algae-resistant granules"], pricePerSquareCents: 88_800 },
    { tierKey: "better", customerName: "CertainTeed Landmark", manufacturerName: "CertainTeed", productLineName: "Landmark", customerDescription: "The most-installed CertainTeed shingle.", warrantySummary: "SureStart PLUS 5-Star", differentiators: ["Max Def colors", "130 mph wind"], pricePerSquareCents: 107_500 },
    { tierKey: "best", customerName: "CertainTeed Landmark PRO", manufacturerName: "CertainTeed", productLineName: "Landmark PRO", customerDescription: "Heavier, deeper-dimension shingle.", warrantySummary: "SureStart PLUS 5-Star", differentiators: ["Heavier weight"], pricePerSquareCents: 145_000 },
  ],
  addOns: [
    { label: "Decking sheets", explanation: "Replace soft plywood found at tear-off", calculationKind: "per_unit", unitValue: 122.5, quantity: 4 },
    { label: "Steep pitch", explanation: null, calculationKind: "percentage", unitValue: 15, quantity: 1 },
  ],
};

describe("ProposalDocument", () => {
  it("prints each option with the included add-ons priced against it", async () => {
    const pdf = await renderToBuffer(<ProposalDocument {...props} />);
    if (process.env.PROPOSAL_PDF_OUT) writeFileSync(process.env.PROPOSAL_PDF_OUT, pdf);
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true });
    expect(text).toContain("Prepared for Dana Whitfield");
    expect(text).toContain("CertainTeed Landmark PRO");
    // Letter-spaced labels come back from text extraction with gaps.
    const compact = text.replace(/\s+/g, "");
    expect(compact).toContain("RECOMMENDED");
    expect(compact).toContain("POWEREDBYRAKE");
    // Landmark: 29.6 sq × $1,075 = $31,820; + 4 × $122.50 = $490; + 15% = $4,773 → $37,083.
    expect(text).toContain("$37,083");
    expect(text).toContain("$490");
  }, 30_000);
});
