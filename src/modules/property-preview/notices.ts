// Public copy for the value-first flow's two passive notices. Each names the
// exact button it sits above, because clicking that button is the agreement.

export const PREVIEW_ADDRESS_SUBMIT_LABEL = "See my roof";
export const PREVIEW_CONTACT_SUBMIT_LABEL = "Unlock my price";

/** Address step: property processing only (version all-season-property-preview-v1). */
export function propertyProcessingNotice(brandName: string, submitLabel = PREVIEW_ADDRESS_SUBMIT_LABEL) {
  return `By clicking “${submitLabel},” you authorize ${brandName} to review this address using property records, maps, and imagery.`;
}

/** Contact step: calls, texts and email only (version all-season-campaign-estimate-v3). */
export function contactOnlyNotice(brandName: string, submitLabel = PREVIEW_CONTACT_SUBMIT_LABEL) {
  return `By clicking “${submitLabel},” you agree that ${brandName} may contact you about this request by call, text, or email at the number and email you provided, including by autodialed calls, prerecorded or artificial voice messages, and automated texts. Consent is not required to purchase. Message frequency varies. Message and data rates may apply. Reply STOP to opt out.`;
}
