"use client";

import {Analytics} from "@vercel/analytics/next";

/**
 * Vercel Web Analytics is cookieless and aggregate: it sets no identifier, and
 * reports visitor and pageview counts rather than anything about a person. It is
 * therefore treated as necessary measurement and is not gated on consent.
 *
 * Gating it previously meant the site could not distinguish "nobody visited"
 * from "nobody accepted the banner", which made every traffic number
 * unreadable. Consent still governs the technologies that genuinely need it --
 * PostHog session replay and Meta advertising -- via PrivacyConsentProvider.
 */
export function ConsentAwareVercelAnalytics() {
  return <Analytics />;
}
