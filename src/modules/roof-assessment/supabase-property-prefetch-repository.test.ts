import {describe, expect, test, vi} from "vitest";
import {type AddressValidationResult} from "@/domain/property-identity";
import {
  PropertyPrefetchPersistenceError,
  SupabasePropertyPrefetchRepository,
} from "./supabase-property-prefetch-repository";

const EVIDENCE: AddressValidationResult = {
  submittedAddress: "354 Stockton St, Princeton, NJ 08540",
  googlePlaceId: "ChIJ-selected",
  canonicalAddress: "354 Stockton St, Princeton, NJ 08540, USA",
  latitude: 40.3402,
  longitude: -74.6701,
  municipality: "Princeton",
  county: "Mercer County",
  stateCode: "NJ",
  zip: "08540",
  matchMethod: "exact_single_match",
  confidence: 98,
};

const APPLY_INPUT = {
  companyId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  evidence: EVIDENCE,
  provider: "google_places" as const,
  sourceIdentifier: "ChIJ-selected",
  retrievedAt: "2026-08-28T20:00:00.000Z",
  providerDurationMs: 32,
};

function client(rpc: ReturnType<typeof vi.fn>) {
  return {rpc} as never;
}

describe("SupabasePropertyPrefetchRepository", () => {
  test("requires an eligible preflight row before provider work", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{eligible: true, assessment_id: "00000000-0000-4000-8000-000000000003", property_id: "00000000-0000-4000-8000-000000000004", pipeline_run_id: "00000000-0000-4000-8000-000000000005"}],
      error: null,
    });
    const repository = new SupabasePropertyPrefetchRepository(client(rpc));

    await expect(repository.resolveScope({
      companyId: APPLY_INPUT.companyId,
      attemptId: APPLY_INPUT.attemptId,
      googlePlaceId: "ChIJ-selected",
    })).resolves.toEqual({eligible: true});
    expect(rpc).toHaveBeenCalledWith("resolve_roof_assessment_property_prefetch_scope", {
      company_id: APPLY_INPUT.companyId,
      attempt_id: APPLY_INPUT.attemptId,
      google_place_id: "ChIJ-selected",
    });
  });

  test("returns ineligible for the strict one-row false preflight response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{eligible: false, assessment_id: null, property_id: null, pipeline_run_id: null}], error: null,
    });
    const repository = new SupabasePropertyPrefetchRepository(client(rpc));

    await expect(repository.resolveScope({
      companyId: APPLY_INPUT.companyId,
      attemptId: APPLY_INPUT.attemptId,
      googlePlaceId: "ChIJ-selected",
    })).resolves.toEqual({eligible: false});
  });

  test("maps exact evidence to the apply RPC and projects its strict response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{assessment_id: "00000000-0000-4000-8000-000000000003", property_id: "00000000-0000-4000-8000-000000000004", pipeline_run_id: "00000000-0000-4000-8000-000000000005", side_effects_applied: true}],
      error: null,
    });
    const repository = new SupabasePropertyPrefetchRepository(client(rpc));

    await expect(repository.apply(APPLY_INPUT)).resolves.toEqual({sideEffectsApplied: true});
    expect(rpc).toHaveBeenCalledWith("apply_roof_assessment_property_prefetch", {
      p_company_id: APPLY_INPUT.companyId,
      p_attempt_id: APPLY_INPUT.attemptId,
      p_google_place_id: "ChIJ-selected",
      p_submitted_address: EVIDENCE.submittedAddress,
      p_canonical_address: EVIDENCE.canonicalAddress,
      p_latitude: EVIDENCE.latitude,
      p_longitude: EVIDENCE.longitude,
      p_municipality: EVIDENCE.municipality,
      p_county: EVIDENCE.county,
      p_state_code: "NJ",
      p_zip: EVIDENCE.zip,
      p_match_method: "exact_single_match",
      p_confidence: 98,
      p_provider: "google_places",
      p_source_identifier: "ChIJ-selected",
      p_retrieved_at: APPLY_INPUT.retrievedAt,
      p_provider_duration_ms: 32,
    });
  });

  test("sanitizes Supabase errors and malformed RPC rows", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({data: null, error: {message: "contains address"}})
      .mockResolvedValueOnce({data: [{side_effects_applied: "yes"}], error: null});
    const repository = new SupabasePropertyPrefetchRepository(client(rpc));

    await expect(repository.apply(APPLY_INPUT)).rejects.toBeInstanceOf(PropertyPrefetchPersistenceError);
    await expect(repository.apply(APPLY_INPUT)).rejects.toBeInstanceOf(PropertyPrefetchPersistenceError);
  });
});
