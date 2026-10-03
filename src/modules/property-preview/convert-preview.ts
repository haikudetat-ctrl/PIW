import { z } from "zod";
import type { AllSeasonCampaignEstimateInput } from "@/app/api/integrations/all-season/campaign-estimate/schema";
import { PREVIEW_CONTACT_DISCLOSURE_VERSION } from "./disclosure";

// Builds the canonical campaign-estimate intake input for a preview conversion.
// Address, campaign, entry point and attribution come from the server-held
// preview, never from the browser; the browser supplies only contact details.

export const previewContactSchema = z.strictObject({
  submission_id: z.uuid(),
  name: z.string().trim().min(2).max(160),
  email: z.email().max(320),
  phone: z.string().trim().min(7).max(40),
});

export type PreviewContact = z.infer<typeof previewContactSchema>;

export type ConvertiblePreview = {
  submitted_address: string;
  canonical_address: string | null;
  google_place_id: string | null;
  campaign: string | null;
  entry_point: string;
  presentation_key: string;
  attribution: unknown;
  referrer: string | null;
};

const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid"] as const;

export function buildPreviewConversionInput(input: {
  preview: ConvertiblePreview;
  contact: PreviewContact;
  clientIp: string;
  userAgent: string;
  advertisingCookies: {fbp: string | null; fbc: string | null};
  now: Date;
}): AllSeasonCampaignEstimateInput {
  const stored = input.preview.attribution && typeof input.preview.attribution === "object"
    ? input.preview.attribution as Record<string, unknown>
    : {};
  const attribution = Object.fromEntries(
    ATTRIBUTION_KEYS.map((key) => [key, typeof stored[key] === "string" ? stored[key] : null]),
  ) as Record<(typeof ATTRIBUTION_KEYS)[number], string | null>;

  return {
    submission_id: input.contact.submission_id,
    campaign: input.preview.campaign as AllSeasonCampaignEstimateInput["campaign"],
    presentation_key: input.preview.presentation_key as AllSeasonCampaignEstimateInput["presentation_key"],
    entry_point: input.preview.entry_point as AllSeasonCampaignEstimateInput["entry_point"],
    name: input.contact.name,
    email: input.contact.email,
    phone: input.contact.phone,
    source: "all-season-campaign",
    submittedAt: input.now.toISOString(),
    disclosure_version: PREVIEW_CONTACT_DISCLOSURE_VERSION,
    client_ip_address: input.clientIp,
    client_user_agent: input.userAgent,
    referrer: input.preview.referrer,
    attribution: {...attribution, fbp: input.advertisingCookies.fbp, fbc: input.advertisingCookies.fbc},
    address: input.preview.canonical_address ?? input.preview.submitted_address,
    google_place_id: input.preview.google_place_id,
    consent_to_contact: true,
    consent_to_process_property: true,
  };
}
