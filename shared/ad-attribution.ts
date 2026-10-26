import {createHmac, timingSafeEqual} from "node:crypto";
import {z} from "zod";

/**
 * First-party ad attribution shared by the website (which mints it) and PIW
 * (which reads it at lead acceptance).
 *
 * The token holds the first and the most recent paid touch: ad-platform click
 * IDs, UTM tags and Google Ads ValueTrack values, plus the landing path. It
 * never holds contact details, IP addresses or a persistent visitor
 * identifier. It is HMAC-signed so PIW can trust it when the website forwards
 * it server to server, and so a visitor cannot forge a click ID into it.
 *
 * Privacy boundary: under Global Privacy Control the click IDs are dropped at
 * capture, so only campaign-level tags (UTMs, ValueTrack) survive. Whether a
 * conversion may later be sent to an ad platform is decided separately, from
 * the lead's recorded consent, at delivery time.
 */

export const AD_ATTRIBUTION_COOKIE_NAME = "as_attr";
export const AD_ATTRIBUTION_TOKEN_VERSION = 1;
/** Matches Google Ads' longest click-through conversion window. */
export const AD_ATTRIBUTION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const MAX_AGE_MS = AD_ATTRIBUTION_MAX_AGE_SECONDS * 1_000;
/** Browsers cap a cookie near 4 KB; leave room for the name and attributes. */
export const AD_ATTRIBUTION_MAX_TOKEN_LENGTH = 3_600;

export const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid", "msclkid", "fbclid"] as const;
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"] as const;
/**
 * Google Ads ValueTrack parameters requested in the account's Final URL
 * suffix (see docs/runbooks/google-ads.md). gad_source and gad_campaignid are
 * appended by Google automatically.
 */
export const VALUETRACK_KEYS = [
  "gad_source",
  "gad_campaignid",
  "campaignid",
  "adgroupid",
  "keyword",
  "matchtype",
  "creative",
  "device",
  "network",
  "targetid",
  "loc_physical_ms",
  "loc_interest_ms",
] as const;

export type ClickIdKey = (typeof CLICK_ID_KEYS)[number];
export type UtmKey = (typeof UTM_KEYS)[number];
export type ValueTrackKey = (typeof VALUETRACK_KEYS)[number];

const CLICK_ID_MAX_LENGTH = 512;
const VALUE_MAX_LENGTH = 200;
const PATH_MAX_LENGTH = 300;

const boundedValue = (max: number) => z.string().min(1).max(max).optional();

const touchSchema = z.strictObject({
  at: z.iso.datetime({offset: true}),
  path: z.string().min(1).max(PATH_MAX_LENGTH),
  host: z.string().min(1).max(255),
  ...Object.fromEntries(CLICK_ID_KEYS.map((key) => [key, boundedValue(CLICK_ID_MAX_LENGTH)])) as Record<ClickIdKey, ReturnType<typeof boundedValue>>,
  ...Object.fromEntries(UTM_KEYS.map((key) => [key, boundedValue(VALUE_MAX_LENGTH)])) as Record<UtmKey, ReturnType<typeof boundedValue>>,
  ...Object.fromEntries(VALUETRACK_KEYS.map((key) => [key, boundedValue(VALUE_MAX_LENGTH)])) as Record<ValueTrackKey, ReturnType<typeof boundedValue>>,
});

const stateSchema = z.strictObject({
  v: z.literal(AD_ATTRIBUTION_TOKEN_VERSION),
  first: touchSchema.optional(),
  last: touchSchema,
});

export type AdTouch = z.infer<typeof touchSchema>;
export type AdAttributionState = z.infer<typeof stateSchema>;

export type AdChannel = "google_ads" | "microsoft_ads" | "meta_ads" | "other_paid" | "untracked";

function bounded(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Strip control characters; ad platforms never put them in these values.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, max);
}

/** ValueTrack leaves the literal "{keyword}" when a value is unavailable. */
function realValueTrack(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\{[a-z_]+\}$/i.test(value) ? undefined : value;
}

/**
 * Returns a touch only when the URL carries an attribution signal. Plain
 * navigation never overwrites the touch that brought the visitor in.
 */
export function extractTouch(
  url: URL,
  now: Date,
  options: {gpc: boolean},
): AdTouch | null {
  const query = url.searchParams;
  const touch: Record<string, string> = {
    at: now.toISOString(),
    path: url.pathname.slice(0, PATH_MAX_LENGTH) || "/",
    host: url.hostname.slice(0, 255),
  };
  let signals = 0;

  if (!options.gpc) {
    for (const key of CLICK_ID_KEYS) {
      const value = bounded(query.get(key), CLICK_ID_MAX_LENGTH);
      if (value) {
        touch[key] = value;
        signals += 1;
      }
    }
  }
  for (const key of UTM_KEYS) {
    const value = bounded(query.get(key), VALUE_MAX_LENGTH);
    if (value) {
      touch[key] = value;
      signals += 1;
    }
  }
  for (const key of VALUETRACK_KEYS) {
    const value = realValueTrack(bounded(query.get(key), VALUE_MAX_LENGTH));
    if (value) {
      touch[key] = value;
      signals += 1;
    }
  }

  if (signals === 0) return null;
  const parsed = touchSchema.safeParse(touch);
  return parsed.success ? parsed.data : null;
}

function isFresh(touch: AdTouch | undefined, now: Date): touch is AdTouch {
  if (!touch) return false;
  const at = Date.parse(touch.at);
  return Number.isFinite(at) && now.getTime() - at <= MAX_AGE_MS && at <= now.getTime() + 60_000;
}

/** First touch is kept while it is inside the window; the latest touch always wins "last". */
export function mergeTouch(
  existing: AdAttributionState | null,
  touch: AdTouch,
  now: Date,
): AdAttributionState {
  const priorFirst = existing && isFresh(existing.first ?? existing.last, now)
    ? existing.first ?? existing.last
    : undefined;
  return {
    v: AD_ATTRIBUTION_TOKEN_VERSION,
    ...(priorFirst ? {first: priorFirst} : {}),
    last: touch,
  };
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(`ad-attribution:v1:${encodedPayload}`, "ascii").digest();
}

export function signingSecretIsUsable(secret: string | undefined): secret is string {
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
}

export function encodeAttributionToken(state: AdAttributionState, secret: string): string | null {
  if (!signingSecretIsUsable(secret)) return null;
  const candidates: AdAttributionState[] = [state];
  // When both touches do not fit, the most recent touch is the one that
  // matters for conversion upload; drop the first.
  if (state.first) candidates.push({v: state.v, last: state.last});
  for (const candidate of candidates) {
    const encodedPayload = base64Url(JSON.stringify(candidate));
    const token = `${encodedPayload}.${base64Url(signature(encodedPayload, secret))}`;
    if (token.length <= AD_ATTRIBUTION_MAX_TOKEN_LENGTH) return token;
  }
  return null;
}

export function decodeAttributionToken(
  value: string | null | undefined,
  secret: string | undefined,
  now: Date,
): AdAttributionState | null {
  if (!value || !signingSecretIsUsable(secret) || value.length > AD_ATTRIBUTION_MAX_TOKEN_LENGTH) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload) || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) return null;

  const expected = signature(encodedPayload, secret);
  const provided = Buffer.from(encodedSignature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = stateSchema.safeParse(decoded);
  if (!parsed.success || !isFresh(parsed.data.last, now)) return null;
  return {
    v: parsed.data.v,
    ...(isFresh(parsed.data.first, now) ? {first: parsed.data.first} : {}),
    last: parsed.data.last,
  };
}

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsearch", "paid_search", "paid-search", "sem", "paid_social", "paidsocial", "paid-social", "display", "cpm"]);
const GOOGLE_SOURCES = new Set(["google", "google_ads", "googleads", "adwords"]);
const META_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta"]);
const MICROSOFT_SOURCES = new Set(["bing", "microsoft", "msads", "microsoft_ads"]);

/** Channel credit for internal reporting. Click IDs outrank tags. */
export function classifyTouch(touch: AdTouch | null | undefined): AdChannel {
  if (!touch) return "untracked";
  if (touch.gclid || touch.gbraid || touch.wbraid) return "google_ads";
  if (touch.msclkid) return "microsoft_ads";
  if (touch.fbclid) return "meta_ads";
  const source = touch.utm_source?.toLowerCase();
  const medium = touch.utm_medium?.toLowerCase();
  const paid = medium ? PAID_MEDIUMS.has(medium) : false;
  if (source && GOOGLE_SOURCES.has(source) && (paid || touch.campaignid || touch.gad_source)) return "google_ads";
  if (touch.gad_source || touch.gad_campaignid) return "google_ads";
  if (source && MICROSOFT_SOURCES.has(source) && paid) return "microsoft_ads";
  if (source && META_SOURCES.has(source) && paid) return "meta_ads";
  if (paid) return "other_paid";
  return "untracked";
}

/**
 * Cookie scope. The registrable domain lets estimate.<domain> read what the
 * main site captured. Preview hosts on a public suffix (vercel.app) and local
 * hosts stay host-only.
 */
export function attributionCookieDomain(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) return undefined;
  if (host.endsWith(".vercel.app") || host === "vercel.app") return undefined;
  const labels = host.split(".");
  if (labels.length < 2) return undefined;
  return labels.slice(-2).join(".");
}
