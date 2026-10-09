import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";
import {trustedRequestIp, type DeploymentEnvironment} from "@/modules/roof-assessment/trusted-request-ip";

// Pre-consent arrival log for tenant estimate hosts (estimate.allseasonroofingquote.com).
// Ads now land here instead of the website, so this mirrors the website's
// arrival beacon (apps/website/lib/arrival-beacon.ts) into the same
// website_arrivals table: no raw IP, no contact details, no preview tokens.

type ArrivalRow = Database["public"]["Tables"]["website_arrivals"]["Insert"];

const CAMPAIGN_SLUGS = ["weather-report", "seasonal-shield", "for-every-season"] as const;
type CampaignSlug = (typeof CAMPAIGN_SLUGS)[number];

// Keep in sync with apps/website/lib/arrival-beacon.ts.
const BOT_PATTERN =
  /bot|crawler|spider|crawling|facebookexternalhit|slurp|bingpreview|headlesschrome|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|postman/i;

/** Only full page loads of the public estimate pages; never APIs, assets, or in-app navigations. */
export function shouldLogEstimateArrival(request: {method: string; nextUrl: URL; headers: Pick<Headers, "get">}) {
  if (request.method !== "GET") return false;
  const {pathname} = request.nextUrl;
  if (!(pathname === "/roof-estimate" || pathname.startsWith("/roof-estimate/") || pathname === "/privacy")) return false;
  const headers = request.headers;
  return !headers.get("rsc")
    && !headers.get("next-router-prefetch")
    && headers.get("purpose") !== "prefetch"
    && headers.get("sec-purpose")?.includes("prefetch") !== true;
}

/** Preview and estimate links carry bearer tokens in the path; they are never stored. */
export function redactArrivalPath(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => (segment.length >= 16 ? "[token]" : segment))
    .join("/")
    .slice(0, 500);
}

function bounded(value: string | null, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function referrerHost(referrer: string | null) {
  if (!referrer) return null;
  try {
    return bounded(new URL(referrer).hostname, 255);
  } catch {
    return null;
  }
}

async function visitorHash(salt: string, now: Date, ip: string | null, userAgent: string | null) {
  const material = `${salt}:${now.toISOString().slice(0, 10)}|${ip ?? "unknown"}|${userAgent ?? "unknown"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildEstimateArrival(input: {
  url: URL;
  headers: Pick<Headers, "get">;
  ip: string | null;
  salt: string;
  now: Date;
  companyId: string;
}): Promise<ArrivalRow> {
  const {url, headers, ip, salt, now, companyId} = input;
  const query = url.searchParams;
  const userAgent = bounded(headers.get("user-agent"), 1_000);
  const campaign = query.get("campaign");
  return {
    company_id: companyId,
    occurred_at: now.toISOString(),
    request_path: redactArrivalPath(url.pathname),
    campaign_slug: CAMPAIGN_SLUGS.find((slug): slug is CampaignSlug => slug === campaign) ?? null,
    visitor_hash: await visitorHash(salt, now, ip, userAgent),
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
    is_likely_bot: userAgent ? BOT_PATTERN.test(userAgent) : true,
    experiment_arm: "value_first",
  };
}

/** Same-day visitor dedupe salt; falls back to a value derived from the intake secret. */
export function arrivalVisitorSalt(environment: Record<string, string | undefined>) {
  const explicit = environment.ARRIVAL_VISITOR_SALT?.trim();
  if (explicit) return explicit;
  const intakeSecret = environment.ALL_SEASON_INTAKE_SHARED_SECRET?.trim();
  return intakeSecret ? `estimate-arrivals:${intakeSecret}` : null;
}

function deploymentEnvironment(value: string | undefined): DeploymentEnvironment {
  return value === "production" || value === "preview" || value === "test" ? value : "development";
}

/**
 * Best effort by design: called from middleware inside waitUntil, after the
 * response is on its way. Missing configuration or a database fault costs a
 * log row, never a page view.
 */
export async function recordEstimateArrival(
  request: {nextUrl: URL; headers: Pick<Headers, "get">},
  host: string,
  dependencies: {
    client: SupabaseClient<Database>;
    environment: Record<string, string | undefined>;
    now?: () => Date;
  },
) {
  try {
    const salt = arrivalVisitorSalt(dependencies.environment);
    if (!salt) return;
    const {data: tenant, error: lookupError} = await dependencies.client
      .from("company_public_hosts")
      .select("company_id, verified_at")
      .eq("host", host)
      .maybeSingle();
    if (lookupError || !tenant?.verified_at) return;

    const row = await buildEstimateArrival({
      url: request.nextUrl,
      headers: request.headers,
      ip: trustedRequestIp(request.headers, deploymentEnvironment(dependencies.environment.DEPLOYMENT_ENV)),
      salt,
      now: dependencies.now?.() ?? new Date(),
      companyId: tenant.company_id,
    });
    const {error} = await dependencies.client.from("website_arrivals").insert(row);
    if (error) console.error("estimate arrival insert failed", {code: error.code});
  } catch {
    // Logging must never surface to the visitor.
  }
}
