export type GoogleAdsConfig = {
  /** Google tag ID for the Ads account, e.g. AW-123456789. */
  tagId: string;
  /** Conversion label for the "Estimate started" conversion action. */
  leadConversionLabel: string;
};

/**
 * Browser tracking is optional. Like the Meta Pixel, the Google tag only turns
 * on behind an explicit flag, well-formed IDs, and the privacy-signing boundary
 * that lets the consent provider authorize advertising.
 */
export function websiteGoogleAdsConfig(
  environment: Record<string, string | undefined>,
): GoogleAdsConfig | null {
  const tagId = environment.NEXT_PUBLIC_GOOGLE_ADS_TAG_ID?.trim() ?? "";
  const leadConversionLabel = environment.NEXT_PUBLIC_GOOGLE_ADS_LEAD_CONVERSION_LABEL?.trim() ?? "";
  const signingSecret = environment.PRIVACY_CONSENT_SIGNING_SECRET;
  const enabled = environment.NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED === "true"
    && /^AW-\d{6,20}$/.test(tagId)
    && /^[A-Za-z0-9_-]{4,64}$/.test(leadConversionLabel)
    && Boolean(signingSecret)
    && Buffer.byteLength(signingSecret ?? "", "utf8") >= 32;
  return enabled ? {tagId, leadConversionLabel} : null;
}
