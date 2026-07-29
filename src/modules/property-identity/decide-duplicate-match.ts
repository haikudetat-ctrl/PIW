import type { DuplicateMatchDecision } from "@/domain/property-identity";

export function decideDuplicateMatch(
  candidates: { propertyId: string }[],
): DuplicateMatchDecision {
  if (candidates.length === 0) return { outcome: "no_match" };
  if (candidates.length === 1) {
    return { outcome: "merge", canonicalPropertyId: candidates[0].propertyId };
  }
  return {
    outcome: "ambiguous",
    candidatePropertyIds: candidates.map((candidate) => candidate.propertyId),
  };
}
