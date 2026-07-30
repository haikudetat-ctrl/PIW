import { expect, test } from "vitest";
import type { ParcelData } from "@/domain/property-identity";
import { decideParcelResolution } from "./decide-parcel-resolution";

function parcel(overrides: Partial<ParcelData> = {}): ParcelData {
  return {
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
    geometry: null,
    ...overrides,
  };
}

test("zero candidates requires unsupported-property review", () => {
  expect(decideParcelResolution([])).toEqual({
    outcome: "review",
    reason: "unsupported_property_type",
  });
});

test("a single class-2 residential parcel resolves", () => {
  const candidate = parcel();

  expect(decideParcelResolution([candidate])).toEqual({
    outcome: "resolved",
    parcel: candidate,
  });
});

test("a single parcel with multiple dwelling units requires condo review", () => {
  expect(
    decideParcelResolution([
      parcel({ dwellingUnits: 4, qualifier: "C0001" }),
    ]),
  ).toEqual({
    outcome: "review",
    reason: "condo_ambiguity",
  });
});

test("a commercial property class requires human review", () => {
  expect(decideParcelResolution([parcel({ propertyClass: "4A" })])).toEqual({
    outcome: "review",
    reason: "commercial_property",
  });
});

test("an unrecognized property class is unsupported", () => {
  expect(decideParcelResolution([parcel({ propertyClass: "15F" })])).toEqual({
    outcome: "review",
    reason: "unsupported_property_type",
  });
});

test("multiple distinct parcels require multiple-parcels review", () => {
  expect(decideParcelResolution([parcel(), parcel({ lot: "6" })])).toEqual({
    outcome: "review",
    reason: "multiple_parcels",
  });
});

test("multiple candidates for one block and lot require condo review", () => {
  expect(
    decideParcelResolution([
      parcel({ qualifier: "C0001" }),
      parcel({ qualifier: "C0002" }),
    ]),
  ).toEqual({
    outcome: "review",
    reason: "condo_ambiguity",
  });
});
