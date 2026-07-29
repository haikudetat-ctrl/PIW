import type { ParcelData } from "@/domain/property-identity";

export type ParcelResolutionDecision =
  | { outcome: "resolved"; parcel: ParcelData }
  | {
      outcome: "review";
      reason:
        | "multiple_parcels"
        | "condo_ambiguity"
        | "commercial_property"
        | "unsupported_property_type";
    };

// NJ MOD-IV class 2 is standard residential property. These are product
// defaults rather than a legal classification system and can be expanded in a
// later phase.
const RESIDENTIAL_CLASSES = new Set(["2"]);
const COMMERCIAL_CLASS_PREFIXES = ["4A", "4B", "4C"];

function isCondoLike(parcel: ParcelData): boolean {
  return Boolean(parcel.qualifier) || (parcel.dwellingUnits ?? 1) > 1;
}

export function decideParcelResolution(
  candidates: ParcelData[],
): ParcelResolutionDecision {
  if (candidates.length === 0) {
    return { outcome: "review", reason: "unsupported_property_type" };
  }

  if (candidates.length > 1) {
    const [first] = candidates;
    const sameParcel = candidates.every(
      (candidate) =>
        candidate.block === first.block && candidate.lot === first.lot,
    );
    return {
      outcome: "review",
      reason: sameParcel ? "condo_ambiguity" : "multiple_parcels",
    };
  }

  const [parcel] = candidates;
  const propertyClass = parcel.propertyClass ?? "";

  if (
    COMMERCIAL_CLASS_PREFIXES.some((prefix) =>
      propertyClass.startsWith(prefix),
    )
  ) {
    return { outcome: "review", reason: "commercial_property" };
  }
  if (!RESIDENTIAL_CLASSES.has(propertyClass)) {
    return { outcome: "review", reason: "unsupported_property_type" };
  }
  if (isCondoLike(parcel)) {
    return { outcome: "review", reason: "condo_ambiguity" };
  }

  return { outcome: "resolved", parcel };
}
