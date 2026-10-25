import {adAttributionForwardingEnabled} from "./ad-attribution";
import {campaignSlugs, type CampaignSlug} from "../app/campaigns/campaigns";
import {landingSlugFromPath, type LandingSlug} from "./landing-slugs";
import {previewFlowEnabled} from "./property-preview-notice";

/**
 * Google Ads and Microsoft Ads click IDs plus the ValueTrack values requested
 * in the Google Ads Final URL suffix. Sent to PIW only once
 * AD_ATTRIBUTION_FORWARDING_ENABLED is on, so a PIW deploy that predates these
 * columns never receives them. Under Global Privacy Control the click IDs are
 * withheld; campaign-level values still identify the ad group and keyword.
 */
export type SearchArrivalFields = {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  msclkid: string | null;
  gad_source: string | null;
  gad_campaignid: string | null;
  google_campaign_id: string | null;
  google_ad_group_id: string | null;
  google_keyword: string | null;
  google_match_type: string | null;
  google_creative_id: string | null;
  google_target_id: string | null;
  google_device: string | null;
  google_network: string | null;
  google_loc_physical_ms: string | null;
};

export type WebsiteArrival = {
  occurred_at: string;
  request_path: string;
  campaign_slug: LandingSlug | null;
  visitor_hash: string;
  user_agent: string | null;
  referrer_host: string | null;
  fbclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  meta_placement: string | null;
  meta_site_source: string | null;
  is_likely_bot: boolean;
  experiment_arm?: "value_first";
} & Partial<SearchArrivalFields>;

const BOT_PATTERN =
  /bot|crawler|spider|crawling|facebookexternalhit|slurp|bingpreview|headlesschrome|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|postman/i;

/**
 * Paths worth a row. The proxy has no matcher config -- narrowing one would also
 * narrow the static-page rewrite it already performs -- so arrivals are filtered
 * here instead: build output, the image optimiser, API routes and static assets
 * would multiply rows without adding signal.
 */
const SKIP_PATH =
  /^\/(?:_next\/|api\/|favicon\.ico$|robots\.txt$|sitemap\.xml$)|\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|map|txt|xml|json|woff2?|ttf|eot)$/i;

export function shouldLogArrival(pathname: string): boolean {
  return !SKIP_PATH.test(pathname);
}

/**
 * Vulnerability scanners probe these with ordinary browser agents. The site
 * serves no PHP, dotfiles or CGI, so a request for one is never a homeowner.
 * Keep in sync with public.is_scanner_request_path().
 */
const SCANNER_PATH =
  /^\/(?:wp-admin|wp-includes|wp-content|vendor|cgi-bin|\.git)(?:\/|$)|^\/\.env|\.php$/i;

/** Advisory only. Rows are still recorded so the raw arrival record stays complete. */
export function isLikelyBot(userAgent: string | null, pathname?: string): boolean {
  if (pathname !== undefined && SCANNER_PATH.test(pathname)) return true;
  return userAgent ? BOT_PATTERN.test(userAgent) : true;
}

/** Rotates the visitor digest daily so it supports same-day dedupe and nothing longer. */
export function visitorSaltForDay(secret: string, now: Date): string {
  return `${secret}:${now.toISOString().slice(0, 10)}`;
}

export async function visitorHash(
  secret: string,
  now: Date,
  ip: string | null,
  userAgent: string | null,
): Promise<string> {
  const material = `${visitorSaltForDay(secret, now)}|${ip ?? "unknown"}|${userAgent ?? "unknown"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bounded(value: string | null, max: number): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

function campaignSlugFromPath(pathname: string, includeSearchPages: boolean): LandingSlug | null {
  if (includeSearchPages) return landingSlugFromPath(pathname);
  const match = /^\/campaigns\/([^/]+)/.exec(pathname);
  const candidate = match?.[1];
  return campaignSlugs.find((slug): slug is CampaignSlug => slug === candidate) ?? null;
}

/** ValueTrack leaves the literal "{keyword}" when a value is unavailable. */
function valueTrack(query: URLSearchParams, key: string, max: number): string | null {
  const value = bounded(query.get(key), max);
  return value && /^\{[a-z_]+\}$/i.test(value) ? null : value;
}

export function searchArrivalFields(query: URLSearchParams, gpc: boolean): SearchArrivalFields {
  const clickId = (key: string) => gpc ? null : bounded(query.get(key), 512);
  return {
    gclid: clickId("gclid"),
    gbraid: clickId("gbraid"),
    wbraid: clickId("wbraid"),
    msclkid: clickId("msclkid"),
    gad_source: valueTrack(query, "gad_source", 50),
    gad_campaignid: valueTrack(query, "gad_campaignid", 50),
    google_campaign_id: valueTrack(query, "campaignid", 50),
    google_ad_group_id: valueTrack(query, "adgroupid", 50),
    google_keyword: valueTrack(query, "keyword", 200),
    google_match_type: valueTrack(query, "matchtype", 20),
    google_creative_id: valueTrack(query, "creative", 50),
    google_target_id: valueTrack(query, "targetid", 100),
    google_device: valueTrack(query, "device", 20),
    google_network: valueTrack(query, "network", 20),
    google_loc_physical_ms: valueTrack(query, "loc_physical_ms", 50),
  };
}

function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return bounded(new URL(referrer).hostname, 255);
  } catch {
    return null;
  }
}

export async function buildArrival(input: {
  url: URL;
  headers: Pick<Headers, "get">;
  ip: string | null;
  secret: string;
  now: Date;
}): Promise<WebsiteArrival> {
  const {url, headers, ip, secret, now} = input;
  const query = url.searchParams;
  const userAgent = bounded(headers.get("user-agent"), 1_000);
  const forwardSearchFields = adAttributionForwardingEnabled(process.env);
  const gpc = headers.get("sec-gpc") === "1";

  return {
    occurred_at: now.toISOString(),
    request_path: url.pathname.slice(0, 500),
    campaign_slug: campaignSlugFromPath(url.pathname, forwardSearchFields),
    visitor_hash: await visitorHash(secret, now, ip, userAgent),
    user_agent: userAgent,
    referrer_host: referrerHost(headers.get("referer")),
    fbclid: bounded(query.get("fbclid"), 500),
    utm_source: bounded(query.get("utm_source"), 500),
    utm_medium: bounded(query.get("utm_medium"), 500),
    utm_campaign: bounded(query.get("utm_campaign"), 500),
    utm_content: bounded(query.get("utm_content"), 500),
    utm_term: bounded(query.get("utm_term"), 500),
    meta_placement: bounded(query.get("placement") ?? query.get("utm_term"), 200),
    meta_site_source: bounded(query.get("site_source_name"), 200),
    is_likely_bot: isLikelyBot(userAgent, url.pathname),
    // Sent only once the value-first flow is on, so PIW (which accepts the
    // field) never sees it from a deploy that predates it. Absent = legacy.
    ...(previewFlowEnabled() ? {experiment_arm: "value_first" as const} : {}),
    ...(forwardSearchFields ? searchArrivalFields(query, gpc) : {}),
  };
}
