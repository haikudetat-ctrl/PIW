/**
 * Facts the Google search landing pages are allowed to state. Every claim on
 * those pages comes from here so a fact can be corrected in one place.
 *
 * Do not add a review, credential, warranty term, guarantee or service area
 * that AllSeason has not confirmed in writing. Values marked `confirmed:
 * false` are working assumptions the owner asked us to make; confirm them
 * before launch (see docs/runbooks/google-ads.md, "Open facts").
 */
export const companyFacts = {
  brandName: "AllSeason",
  phone: {display: "(866) 835-6022", href: "tel:+18668356022"},
  /** Confirmed by the owner, Oct 2026. */
  experience: {headline: "20+ years", detail: "replacing roofs in New Jersey"},
  certification: {
    name: "CertainTeed ShingleMaster PREMIER",
    shortName: "ShingleMaster PREMIER",
    detail: "CertainTeed's highest contractor credential",
    // AllSeason holds CertainTeed's top tier; PREMIER is CertainTeed's current
    // name for it (2026). Confirm the exact credential before launch.
    confirmed: false,
  },
  /** Confirmed by the owner, Oct 2026. Terms come from the lenders, never from us. */
  financing: {partners: ["Service Finance", "GoodLeap"], qualifier: "subject to credit approval"},
  /** The live estimate flow's configured range (Oct 2026). */
  pricePerSquare: {low: 500, high: 750},
  /** Statewide only until AllSeason confirms a county or town list. */
  serviceArea: "New Jersey",
} as const;

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0}).format(value);
}

/** Worked example for a roof of the given size, from the configured per-square range. */
export function examplePriceRange(squares: number) {
  return {
    squares,
    low: formatUsd(companyFacts.pricePerSquare.low * squares),
    high: formatUsd(companyFacts.pricePerSquare.high * squares),
  };
}

/**
 * New Jersey's Contractors' Registration Act requires the home improvement
 * contractor registration number on advertising. Rendered only once it is set.
 */
export function njHicRegistration(environment: Record<string, string | undefined> = process.env): string | null {
  const value = environment.NEXT_PUBLIC_NJ_HIC_REGISTRATION?.trim();
  return value && /^[0-9A-Za-z-]{4,20}$/.test(value) ? value : null;
}
