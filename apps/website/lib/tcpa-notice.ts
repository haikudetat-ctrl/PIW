// Passive TCPA/property-processing notice shown above every All Season quote
// submit button. Submitting the form is the customer's agreement, so the
// notice must name the exact button label. public/quote-drawer.js, index.html
// and contact.html carry static copies of this text; lead-forms.test.ts keeps
// them in sync.
export const TCPA_DISCLOSURE_VERSION = "all-season-campaign-estimate-v2";

export const PRIVACY_POLICY_HREF = "/privacy.html";

export function tcpaNoticeText(submitLabel: string) {
  return `By clicking “${submitLabel},” you authorize All Season Solar to review this address using property records, maps, and imagery to prepare your estimate, and you agree that All Season Solar may contact you about this request by call, text, or email at the number and email you provided, including by autodialed calls, prerecorded or artificial voice messages, and automated texts. Consent is not required to purchase. Message frequency varies. Message and data rates may apply. Reply STOP to opt out.`;
}
