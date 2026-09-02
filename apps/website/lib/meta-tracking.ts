/**
 * Browser tracking is optional. Do not let malformed rollout settings enable a
 * Pixel without the matching privacy-signing boundary.
 */
export function websiteMetaTrackingEnabled(environment: Record<string, string | undefined>) {
  const pixelId = environment.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";
  const signingSecret = environment.PRIVACY_CONSENT_SIGNING_SECRET;
  return environment.NEXT_PUBLIC_META_TRACKING_ENABLED === "true"
    && /^\d{6,32}$/.test(pixelId)
    && Boolean(signingSecret)
    && Buffer.byteLength(signingSecret ?? "", "utf8") >= 32;
}
