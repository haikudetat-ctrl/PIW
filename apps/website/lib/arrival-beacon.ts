import {campaignSlugs, type CampaignSlug} from "../app/campaigns/campaigns";

export type WebsiteArrival = {
  occurred_at: string;
  request_path: string;
  campaign_slug: CampaignSlug | null;
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
};

const BOT_PATTERN =
  /bot|crawler|spider|crawling|facebookexternalhit|slurp|bingpreview|headlesschrome|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|postman/i;

/** Advisory only. Rows are still recorded so the raw arrival record stays complete. */
export function isLikelyBot(userAgent: string | null): boolean {
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

function campaignSlugFromPath(pathname: string): CampaignSlug | null {
  const match = /^\/campaigns\/([^/]+)/.exec(pathname);
  const candidate = match?.[1];
  return campaignSlugs.find((slug) => slug === candidate) ?? null;
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

  return {
    occurred_at: now.toISOString(),
    request_path: url.pathname.slice(0, 500),
    campaign_slug: campaignSlugFromPath(url.pathname),
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
    is_likely_bot: isLikelyBot(userAgent),
  };
}
