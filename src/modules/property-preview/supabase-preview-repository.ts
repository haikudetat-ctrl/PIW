import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PreviewMeasurementStatus, PropertyPreviewRepository } from "./create-preview";

export class SupabasePropertyPreviewRepository implements PropertyPreviewRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async create(input: Parameters<PropertyPreviewRepository["create"]>[0]) {
    const {data, error} = await this.client.rpc("create_property_preview", {
      p_company_id: input.companyId,
      p_token_hash: input.tokenHash,
      p_submitted_address: input.submittedAddress,
      p_google_place_id: input.googlePlaceId as string,
      p_address_mode: input.addressMode,
      p_campaign: input.campaign as string,
      p_entry_point: input.entryPoint,
      p_presentation_key: input.presentationKey,
      p_attribution: input.attribution,
      p_referrer: input.referrer as string,
      p_processing_disclosure_version: input.processingDisclosureVersion,
      p_processing_accepted_at: input.processingAcceptedAt,
      p_ip_address: input.ipAddress,
      p_user_agent: input.userAgent,
    });
    const row = data?.[0];
    if (error || !row) throw new Error("Failed to create property preview");
    return {previewId: row.preview_id, rateLimited: row.rate_limited};
  }

  async applyPlace(input: Parameters<PropertyPreviewRepository["applyPlace"]>[0]) {
    const {error} = await this.client
      .from("property_previews")
      .update({
        canonical_address: input.canonicalAddress,
        latitude: input.latitude,
        longitude: input.longitude,
        place_resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", input.companyId)
      .eq("id", input.previewId)
      .is("place_resolved_at", null);
    if (error) throw new Error("Failed to store preview place");
  }

  async setMeasurementStatus(input: {companyId: string; previewId: string; status: PreviewMeasurementStatus}) {
    const {error} = await this.client
      .from("property_previews")
      .update({
        measurement_status: input.status,
        ...(input.status === "skipped" ? {reveal_mode: "skipped"} : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", input.companyId)
      .eq("id", input.previewId)
      .eq("measurement_status", "pending");
    if (error) throw new Error("Failed to update preview measurement status");
  }
}

export async function findVerifiedPublicHost(client: SupabaseClient<Database>, companyId: string) {
  const {data, error} = await client
    .from("company_public_hosts")
    .select("host")
    .eq("company_id", companyId)
    .not("verified_at", "is", null)
    .order("created_at", {ascending: true})
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Failed to resolve the company's public host");
  return data?.host ?? null;
}
