import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import type { PreviewReadDependencies } from "./preview-read-model";

const segmentsSchema = z.array(z.object({
  pitchDegrees: z.number(),
  azimuthDegrees: z.number(),
  areaSqft: z.number().nonnegative(),
}));

export function createSupabasePreviewReadDependencies(client: SupabaseClient<Database>): PreviewReadDependencies {
  return {
    async loadPreviewRow({companyId, tokenHash}) {
      const {data, error} = await client
        .from("property_previews")
        .select("id, property_id, status, expires_at, submitted_address, canonical_address, address_mode, latitude, longitude, measurement_status, reveal_mode, roof_insight_id, responses, saved_email, campaign, presentation_key")
        .eq("company_id", companyId)
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) throw new Error("Failed to load property preview");
      return data;
    },
    async loadRoofInsight({companyId, roofInsightId}) {
      const {data, error} = await client
        .from("roof_insights")
        .select("total_roof_sqft, roof_segments")
        .eq("id", roofInsightId)
        .eq("company_id", companyId)
        .eq("lookup_status", "success")
        .maybeSingle();
      if (error) throw new Error("Failed to load preview roof insight");
      const segments = segmentsSchema.safeParse(data?.roof_segments);
      if (!data || data.total_roof_sqft === null || !segments.success) return null;
      return {totalRoofSqft: Number(data.total_roof_sqft), roofSegments: segments.data};
    },
  };
}
