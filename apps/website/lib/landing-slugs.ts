import {campaignSlugs, type CampaignSlug} from "../app/campaigns/campaigns";

/**
 * Google Search landing pages. They share the campaign intake contract (the
 * slug is the durable landing-page identifier on the lead) but live at clean
 * root paths so the ad's display URL and the page match the search intent.
 * Keep in sync with src/config/campaigns.ts in PIW.
 */
export const searchPageSlugs = [
  "roof-replacement",
  "roof-replacement-cost",
  "roofing-contractor",
] as const;

export type SearchPageSlug = (typeof searchPageSlugs)[number];

export const landingSlugs = [...campaignSlugs, ...searchPageSlugs] as const;

export type LandingSlug = CampaignSlug | SearchPageSlug;

export const landingEntryPoints = landingSlugs.map(
  (slug) => `campaign:${slug}` as const,
);

export function isSearchPageSlug(value: string): value is SearchPageSlug {
  return (searchPageSlugs as readonly string[]).includes(value);
}

/** Landing slug for a request path: /campaigns/<slug> or a search page root path. */
export function landingSlugFromPath(pathname: string): LandingSlug | null {
  const campaignMatch = /^\/campaigns\/([^/]+)/.exec(pathname);
  if (campaignMatch) {
    return campaignSlugs.find((slug) => slug === campaignMatch[1]) ?? null;
  }
  const searchMatch = /^\/([^/]+)\/?$/.exec(pathname);
  if (searchMatch && isSearchPageSlug(searchMatch[1])) return searchMatch[1];
  return null;
}
