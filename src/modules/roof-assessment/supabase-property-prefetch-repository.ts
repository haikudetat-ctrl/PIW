import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import type {Database} from "@/lib/database.types";
import type {PropertyPrefetchRepository} from "./post-consent-property-prefetch";

export class PropertyPrefetchPersistenceError extends Error {
  constructor() {
    super("Property prefetch persistence failed");
    this.name = "PropertyPrefetchPersistenceError";
  }
}

const eligibleScopeRowSchema = z.object({
  eligible: z.literal(true),
  assessment_id: z.uuid(),
  property_id: z.uuid(),
  pipeline_run_id: z.uuid(),
}).strict();

const ineligibleScopeRowSchema = z.object({
  eligible: z.literal(false),
  assessment_id: z.null(),
  property_id: z.null(),
  pipeline_run_id: z.null(),
}).strict();

const scopeResponseSchema = z.tuple([
  z.discriminatedUnion("eligible", [eligibleScopeRowSchema, ineligibleScopeRowSchema]),
]);

const applyResponseSchema = z.tuple([z.object({
  assessment_id: z.uuid(),
  property_id: z.uuid(),
  pipeline_run_id: z.uuid(),
  side_effects_applied: z.boolean(),
}).strict()]);

export class SupabasePropertyPrefetchRepository implements PropertyPrefetchRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async resolveScope(input: {
    companyId: string;
    attemptId: string;
    googlePlaceId: string;
  }): Promise<{eligible: boolean}> {
    try {
      const {data, error} = await this.client.rpc(
        "resolve_roof_assessment_property_prefetch_scope",
        {
          company_id: input.companyId,
          attempt_id: input.attemptId,
          google_place_id: input.googlePlaceId,
        },
      );
      if (error) throw new PropertyPrefetchPersistenceError();
      const parsed = scopeResponseSchema.safeParse(data);
      if (!parsed.success) throw new PropertyPrefetchPersistenceError();
      return {eligible: parsed.data[0].eligible};
    } catch {
      throw new PropertyPrefetchPersistenceError();
    }
  }

  async apply(input: Parameters<PropertyPrefetchRepository["apply"]>[0]): Promise<{sideEffectsApplied: boolean}> {
    const {evidence} = input;
    try {
      if (
        evidence.googlePlaceId === null || evidence.googlePlaceId === undefined ||
        evidence.canonicalAddress === null ||
        evidence.latitude === null || !Number.isFinite(evidence.latitude) ||
        evidence.longitude === null || !Number.isFinite(evidence.longitude) ||
        evidence.municipality === null || evidence.county === null ||
        evidence.stateCode !== "NJ" || evidence.zip === null
        || evidence.matchMethod !== "exact_single_match" || evidence.confidence < 95
        || evidence.googlePlaceId !== input.sourceIdentifier
      ) {
        throw new PropertyPrefetchPersistenceError();
      }
      const {data, error} = await this.client.rpc("apply_roof_assessment_property_prefetch", {
        p_company_id: input.companyId,
        p_attempt_id: input.attemptId,
        p_google_place_id: evidence.googlePlaceId,
        p_submitted_address: evidence.submittedAddress,
        p_canonical_address: evidence.canonicalAddress,
        p_latitude: evidence.latitude,
        p_longitude: evidence.longitude,
        p_municipality: evidence.municipality,
        p_county: evidence.county,
        p_state_code: evidence.stateCode,
        p_zip: evidence.zip,
        p_match_method: evidence.matchMethod,
        p_confidence: evidence.confidence,
        p_provider: input.provider,
        p_source_identifier: input.sourceIdentifier,
        p_retrieved_at: input.retrievedAt,
        p_provider_duration_ms: input.providerDurationMs,
      });
      if (error) throw new PropertyPrefetchPersistenceError();
      const parsed = applyResponseSchema.safeParse(data);
      if (!parsed.success) throw new PropertyPrefetchPersistenceError();
      return {sideEffectsApplied: parsed.data[0].side_effects_applied};
    } catch {
      throw new PropertyPrefetchPersistenceError();
    }
  }
}
