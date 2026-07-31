import { expect, test } from "vitest";
import {
  addressMatchMethodSchema,
  addressValidationResultSchema,
  duplicateMatchDecisionSchema,
  parcelDataSchema,
  reviewTaskReasonSchema,
  reviewTaskStatusSchema,
} from "./property-identity";

test("address match method is explicit", () => {
  expect(addressMatchMethodSchema.options).toEqual([
    "exact_single_match",
    "no_match",
    "multiple_matches",
  ]);
});

test("address validation result requires a confidence and match method", () => {
  const result = addressValidationResultSchema.parse({
    submittedAddress: "1600 Pennsylvania Ave, Washington DC",
    canonicalAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
    latitude: 38.89869893252,
    longitude: -77.03518753691,
    municipality: "WASHINGTON",
    county: null,
    stateCode: null,
    zip: "20500",
    matchMethod: "exact_single_match",
    confidence: 97,
  });
  expect(result.confidence).toBe(97);
});

test("parcel data never accepts an owner name field", () => {
  const parcel = parcelDataSchema.parse({
    block: "101",
    lot: "5",
    qualifier: null,
    pamsPin: "0101_5_",
    gisPin: null,
    municipalityCode: "0101",
    municipalityName: "TRENTON CITY",
    county: "MERCER",
    propertyClass: "2",
    acreage: 0.25,
    yearBuilt: 1975,
    landValue: 50000,
    improvementValue: 150000,
    netValue: 200000,
    propertyLocation: "12 BIRCH ST",
    streetAddress: "12 BIRCH ST",
    buildingDescription: null,
    landDescription: null,
    dwellingUnits: 1,
    geometry: { type: "Polygon", coordinates: [] },
  });
  expect(parcel).not.toHaveProperty("ownerName");
});

test("review task reason and status are explicit", () => {
  expect(reviewTaskReasonSchema.options).toEqual([
    "low_address_confidence",
    "duplicate_candidates",
    "multiple_parcels",
    "condo_ambiguity",
    "commercial_property",
    "unsupported_property_type",
  ]);
  expect(reviewTaskStatusSchema.options).toEqual([
    "open",
    "resolved",
    "rejected",
    "retried",
    "unsupported",
  ]);
});

test("duplicate match decision is a discriminated union", () => {
  expect(duplicateMatchDecisionSchema.parse({ outcome: "no_match" })).toEqual({
    outcome: "no_match",
  });
  expect(() => duplicateMatchDecisionSchema.parse({ outcome: "merge" })).toThrow();
});
