import {
  classifyTouch,
  decodeAttributionToken,
  type AdAttributionState,
  type AdChannel,
  type AdTouch,
} from "@/../shared/ad-attribution";
import type { CampaignAttribution } from "@/modules/leads/accept-all-season-campaign-estimate";

/** Row shape for public.lead_ad_attribution. */
export type LeadAdAttributionRow = {
  company_id: string;
  lead_id: string;
  channel: AdChannel;
  click_id_type: "gclid" | "gbraid" | "wbraid" | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  msclkid: string | null;
  fbclid: string | null;
  clicked_at: string | null;
  landing_path: string | null;
  google_campaign_id: string | null;
  google_ad_group_id: string | null;
  google_keyword: string | null;
  google_match_type: string | null;
  google_target_id: string | null;
  google_creative_id: string | null;
  google_device: string | null;
  google_network: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  first_touch: AdTouch | null;
  last_touch: AdTouch | null;
  token_verified: boolean;
};

function value(text: string | null | undefined, max: number): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** ValueTrack's campaignid is the tracking template value; gad_campaignid is Google's auto-tag. */
function campaignId(touch: AdTouch): string | null {
  return value(touch.campaignid ?? touch.gad_campaignid, 50);
}

/**
 * Credit goes to the most recent paid touch: the last touch if it was paid,
 * otherwise the first. Click IDs outrank tags (see classifyTouch).
 */
export function creditedTouch(state: AdAttributionState): AdTouch {
  if (classifyTouch(state.last) !== "untracked") return state.last;
  if (state.first && classifyTouch(state.first) !== "untracked") return state.first;
  return state.last;
}

/** Legacy fields only (no signed token): enough for channel credit, never for upload. */
function legacyTouch(attribution: CampaignAttribution, at: string): AdTouch {
  const touch: Record<string, string> = {at, path: "/", host: "unknown"};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid"] as const) {
    const candidate = value(attribution[key], key === "fbclid" ? 512 : 200);
    if (candidate) touch[key] = candidate;
  }
  return touch as AdTouch;
}

export function buildLeadAdAttribution(input: {
  companyId: string;
  leadId: string;
  token: string | null | undefined;
  secret: string | null;
  legacy: CampaignAttribution;
  submittedAt: string;
  now: Date;
}): LeadAdAttributionRow {
  const state = input.token && input.secret
    ? decodeAttributionToken(input.token, input.secret, input.now)
    : null;
  const touch = state ? creditedTouch(state) : legacyTouch(input.legacy, input.submittedAt);
  const channel = classifyTouch(touch);
  const verified = state !== null;

  // Click IDs for upload come only from the signed token. A gclid typed into
  // the legacy fields cannot be verified and is never uploaded.
  const gclid = verified ? value(touch.gclid, 512) : null;
  const gbraid = verified ? value(touch.gbraid, 512) : null;
  const wbraid = verified ? value(touch.wbraid, 512) : null;

  return {
    company_id: input.companyId,
    lead_id: input.leadId,
    channel,
    click_id_type: gclid ? "gclid" : gbraid ? "gbraid" : wbraid ? "wbraid" : null,
    gclid,
    gbraid,
    wbraid,
    msclkid: verified ? value(touch.msclkid, 512) : null,
    fbclid: value(touch.fbclid ?? input.legacy.fbclid, 512),
    clicked_at: verified ? touch.at : input.submittedAt,
    landing_path: verified ? value(touch.path, 300) : null,
    google_campaign_id: campaignId(touch),
    google_ad_group_id: value(touch.adgroupid, 50),
    google_keyword: value(touch.keyword, 200),
    google_match_type: value(touch.matchtype, 20),
    google_target_id: value(touch.targetid, 100),
    google_creative_id: value(touch.creative, 50),
    google_device: value(touch.device, 20),
    google_network: value(touch.network, 20),
    utm_source: value(touch.utm_source, 200),
    utm_medium: value(touch.utm_medium, 200),
    utm_campaign: value(touch.utm_campaign, 200),
    utm_term: value(touch.utm_term, 200),
    utm_content: value(touch.utm_content, 200),
    first_touch: state?.first ?? null,
    last_touch: state?.last ?? null,
    token_verified: verified,
  };
}

type InsertClient = {
  from(table: "lead_ad_attribution"): {
    upsert(
      row: LeadAdAttributionRow,
      options: {onConflict: string; ignoreDuplicates: boolean},
    ): PromiseLike<{error: unknown}>;
  };
};

/** First write wins: a lead's attribution is fixed at acceptance. */
export async function recordLeadAdAttribution(client: InsertClient, row: LeadAdAttributionRow) {
  const {error} = await client
    .from("lead_ad_attribution")
    .upsert(row, {onConflict: "company_id,lead_id", ignoreDuplicates: true});
  if (error) throw new Error("Failed to record lead ad attribution");
}
