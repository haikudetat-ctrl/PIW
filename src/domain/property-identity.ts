import { z } from "zod";
import { confidenceSchema } from "./evidence";
import { uuidSchema } from "./ids";

export const addressMatchMethodSchema = z.enum([
  "exact_single_match",
  "no_match",
  "multiple_matches",
]);

export const addressValidationResultSchema = z.object({
  submittedAddress: z.string().min(1),
  canonicalAddress: z.string().min(1).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  municipality: z.string().nullable(),
  county: z.string().nullable(),
  stateCode: z.literal("NJ").nullable(),
  zip: z.string().nullable(),
  matchMethod: addressMatchMethodSchema,
  confidence: confidenceSchema,
});
export type AddressValidationResult = z.infer<typeof addressValidationResultSchema>;

export const parcelDataSchema = z.object({
  block: z.string().min(1),
  lot: z.string().min(1),
  qualifier: z.string().nullable(),
  pamsPin: z.string().nullable(),
  gisPin: z.string().nullable(),
  municipalityCode: z.string().nullable(),
  municipalityName: z.string().nullable(),
  county: z.string().nullable(),
  propertyClass: z.string().nullable(),
  acreage: z.number().nonnegative().nullable(),
  yearBuilt: z.number().int().positive().nullable(),
  landValue: z.number().nonnegative().nullable(),
  improvementValue: z.number().nonnegative().nullable(),
  netValue: z.number().nonnegative().nullable(),
  propertyLocation: z.string().nullable(),
  streetAddress: z.string().nullable(),
  buildingDescription: z.string().nullable(),
  landDescription: z.string().nullable(),
  dwellingUnits: z.number().int().nonnegative().nullable(),
  // Opaque GeoJSON polygon geometry; domain layer does not interpret it.
  geometry: z.record(z.string(), z.unknown()).nullable(),
});
export type ParcelData = z.infer<typeof parcelDataSchema>;

export const reviewTaskReasonSchema = z.enum([
  "low_address_confidence",
  "duplicate_candidates",
  "multiple_parcels",
  "condo_ambiguity",
  "commercial_property",
  "unsupported_property_type",
]);

export const reviewTaskStatusSchema = z.enum([
  "open",
  "resolved",
  "rejected",
  "retried",
  "unsupported",
]);

export const duplicateMatchDecisionSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("no_match") }),
  z.object({ outcome: z.literal("merge"), canonicalPropertyId: uuidSchema }),
  z.object({
    outcome: z.literal("ambiguous"),
    candidatePropertyIds: z.array(uuidSchema).min(2),
  }),
]);
export type DuplicateMatchDecision = z.infer<typeof duplicateMatchDecisionSchema>;
