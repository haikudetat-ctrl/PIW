import {NextFetchEvent, NextRequest, NextResponse} from "next/server";
import {buildArrival} from "./lib/arrival-beacon";
import {trustedWebsiteRequestIp} from "./lib/trusted-request-ip";
import {trustedPiwOidcHeaders} from "./lib/vercel-protection";

/**
 * Unconditional, pre-consent arrival log.
 *
 * This is the only measurement on the site that cannot be switched off by a
 * visitor's consent choice, an ad blocker, or an in-app browser, which makes it
 * the ground truth for "did the click actually reach the origin". It records no
 * raw IP and no contact details -- see lib/arrival-beacon.ts.
 *
 * The beacon runs inside event.waitUntil, so it is dispatched after the response
 * has been handed to the visitor. A slow or failing PIW costs log rows; it can
 * never delay or break a page load.
 */
export function middleware(request: NextRequest, event: NextFetchEvent) {
  const response = NextResponse.next();

  const endpoint = process.env.ARRIVAL_INGEST_URL;
  const sharedSecret = process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  const visitorSalt = process.env.ARRIVAL_VISITOR_SALT;
  if (!endpoint || !sharedSecret || !visitorSalt) return response;

  event.waitUntil(
    (async () => {
      try {
        const arrival = await buildArrival({
          url: request.nextUrl,
          headers: request.headers,
          ip: trustedWebsiteRequestIp(request.headers, process.env.NODE_ENV),
          secret: visitorSalt,
          now: new Date(),
        });

        await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-all-season-intake-secret": sharedSecret,
            // Matches the campaign-estimate handoff so the beacon keeps working
            // if PIW's deployment protection is ever widened beyond previews.
            ...trustedPiwOidcHeaders(request.headers),
          },
          body: JSON.stringify({arrivals: [arrival]}),
          signal: AbortSignal.timeout(3_000),
          cache: "no-store",
        });
      } catch {
        // Logging is best effort by design. Swallow everything.
      }
    })(),
  );

  return response;
}

export const config = {
  // Page requests only: never static assets, build output, the image optimizer,
  // or API routes, all of which would multiply rows without adding signal.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|campaigns/.*/hero.webp|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml|woff|woff2|ttf)$).*)",
  ],
};
