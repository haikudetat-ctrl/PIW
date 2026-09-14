import {createHash, timingSafeEqual} from "node:crypto";
import {NextRequest, NextResponse} from "next/server";
import {parseServerEnv} from "@/lib/env/server";
import {createServiceClient} from "@/lib/supabase/service";
import {websiteArrivalBatchSchema} from "./schema";

export const runtime = "nodejs";

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {"cache-control": "no-store"},
  });
}

function secretsMatch(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return actual.length > 0 && expected.length > 0 && timingSafeEqual(digest(actual), digest(expected));
}

/**
 * Pre-consent arrival ingest. The website's edge middleware calls this after the
 * response has already been sent, so this route is never on a visitor's critical
 * path: it answers fast, and a failure here costs log rows, never a page view.
 */
export async function POST(request: NextRequest) {
  let environment: ReturnType<typeof parseServerEnv>;
  try {
    environment = parseServerEnv(process.env);
  } catch {
    return noStoreJson({error: "Arrival ingest is not configured"}, 503);
  }

  const expectedSecret = environment.ALL_SEASON_INTAKE_SHARED_SECRET;
  const companyId = environment.ALL_SEASON_INTAKE_COMPANY_ID;
  if (!expectedSecret || !companyId) {
    return noStoreJson({error: "Arrival ingest is not configured"}, 503);
  }

  const providedSecret = request.headers.get("x-all-season-intake-secret") ?? "";
  if (!secretsMatch(providedSecret, expectedSecret)) {
    return noStoreJson({error: "Unauthorized"}, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({error: "Malformed request body"}, 400);
  }

  const parsed = websiteArrivalBatchSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({error: "Invalid arrival payload"}, 422);
  }

  const rows = parsed.data.arrivals.map((arrival) => ({
    company_id: companyId,
    occurred_at: arrival.occurred_at,
    request_path: arrival.request_path,
    campaign_slug: arrival.campaign_slug ?? null,
    visitor_hash: arrival.visitor_hash,
    user_agent: arrival.user_agent ?? null,
    referrer_host: arrival.referrer_host ?? null,
    fbclid: arrival.fbclid ?? null,
    utm_source: arrival.utm_source ?? null,
    utm_medium: arrival.utm_medium ?? null,
    utm_campaign: arrival.utm_campaign ?? null,
    utm_content: arrival.utm_content ?? null,
    utm_term: arrival.utm_term ?? null,
    meta_placement: arrival.meta_placement ?? null,
    meta_site_source: arrival.meta_site_source ?? null,
    is_likely_bot: arrival.is_likely_bot,
  }));

  const supabase = createServiceClient();
  const {error} = await supabase.from("website_arrivals").insert(rows);
  if (error) {
    // Deliberately not surfaced to the caller: the beacon cannot retry usefully
    // and must never turn a logging fault into visible site behaviour.
    console.error("website_arrivals insert failed", {code: error.code, message: error.message});
    return noStoreJson({error: "Arrival not recorded"}, 502);
  }

  return noStoreJson({recorded: rows.length}, 202);
}
