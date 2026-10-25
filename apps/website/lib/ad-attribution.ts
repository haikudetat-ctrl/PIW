import type {NextRequest, NextResponse} from "next/server";
import {
  AD_ATTRIBUTION_COOKIE_NAME,
  AD_ATTRIBUTION_MAX_AGE_SECONDS,
  attributionCookieDomain,
  decodeAttributionToken,
  encodeAttributionToken,
  extractTouch,
  mergeTouch,
  signingSecretIsUsable,
} from "../../../shared/ad-attribution";

export {AD_ATTRIBUTION_COOKIE_NAME} from "../../../shared/ad-attribution";

type Environment = Record<string, string | undefined>;

/**
 * Rollout gate for every new field the website sends PIW (search arrival
 * columns, the forwarded attribution token, search landing slugs). Turn it on
 * only after the PIW deploy that accepts them is live.
 */
export function adAttributionForwardingEnabled(environment: Environment): boolean {
  return environment.AD_ATTRIBUTION_FORWARDING_ENABLED === "true";
}

export function adAttributionSecret(environment: Environment): string | null {
  const secret = environment.AD_ATTRIBUTION_SIGNING_SECRET;
  return signingSecretIsUsable(secret) ? secret : null;
}

function requestHasGpc(headers: Pick<Headers, "get">) {
  return headers.get("sec-gpc") === "1";
}

/**
 * Returns the cookie to set when this navigation carries an attribution
 * signal, or null when there is nothing new to record. Plain navigation keeps
 * the existing cookie untouched.
 */
export function nextAttributionCookie(input: {
  url: URL;
  headers: Pick<Headers, "get">;
  existing: string | undefined;
  secret: string | null;
  now: Date;
}): {value: string; domain: string | undefined} | null {
  if (!input.secret) return null;
  const touch = extractTouch(input.url, input.now, {gpc: requestHasGpc(input.headers)});
  if (!touch) return null;
  const existing = decodeAttributionToken(input.existing, input.secret, input.now);
  const value = encodeAttributionToken(mergeTouch(existing, touch, input.now), input.secret);
  if (!value) return null;
  return {value, domain: attributionCookieDomain(input.url.hostname)};
}

export function setAttributionCookie(
  response: NextResponse,
  cookie: {value: string; domain: string | undefined},
  secure: boolean,
) {
  response.cookies.set({
    name: AD_ATTRIBUTION_COOKIE_NAME,
    value: cookie.value,
    maxAge: AD_ATTRIBUTION_MAX_AGE_SECONDS,
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
    ...(cookie.domain ? {domain: cookie.domain} : {}),
  });
}

/**
 * The signed token forwarded to PIW with a lead. PIW re-verifies it with the
 * shared secret; the website never forwards a token it cannot verify itself.
 */
export function forwardableAttributionToken(
  request: Pick<NextRequest, "cookies">,
  environment: Environment,
  now: Date = new Date(),
): string | null {
  if (!adAttributionForwardingEnabled(environment)) return null;
  const secret = adAttributionSecret(environment);
  const value = request.cookies.get(AD_ATTRIBUTION_COOKIE_NAME)?.value;
  if (!secret || !value) return null;
  return decodeAttributionToken(value, secret, now) ? value : null;
}
