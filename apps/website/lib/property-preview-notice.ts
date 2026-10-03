// Address-step notice for the value-first quote flow. Clicking the named
// button is the agreement. Keep in sync with propertyProcessingNotice in
// src/modules/property-preview/notices.ts (version all-season-property-preview-v1).
export const PREVIEW_ADDRESS_SUBMIT_LABEL = "See my roof";

export function propertyProcessingNotice(submitLabel = PREVIEW_ADDRESS_SUBMIT_LABEL) {
  return `By clicking “${submitLabel},” you authorize All Season Solar to review this address using property records, maps, and imagery.`;
}

export function previewFlowEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NEXT_PUBLIC_PROPERTY_PREVIEW_ENABLED === "true" && Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
}
