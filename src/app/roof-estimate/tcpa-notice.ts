// Passive TCPA/property-processing notice for the public roof estimate form.
// Submitting the form is the homeowner's agreement, so the notice must name
// the exact submit button label. Bump the version whenever the text changes;
// it is stored on every lead_consent_evidence row.
export const ROOF_ESTIMATE_DISCLOSURE_VERSION = "roof-estimate-v3";

export const ROOF_ESTIMATE_SUBMIT_LABEL = "Get my roof estimate";

export function roofEstimateTcpaNotice(submitLabel = ROOF_ESTIMATE_SUBMIT_LABEL) {
  return `By clicking “${submitLabel},” you authorize us to process this address through Google’s property services to create a preliminary roof estimate, and you agree that we may contact you about this request by call, text, or email at the number and email you provided, including by autodialed calls, prerecorded or artificial voice messages, and automated texts. Consent is not required to purchase. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to opt out.`;
}
