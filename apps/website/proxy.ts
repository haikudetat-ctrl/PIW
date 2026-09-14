import {NextResponse, type NextFetchEvent, type NextRequest} from "next/server";
import {buildArrival, shouldLogArrival} from "./lib/arrival-beacon";
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
 * Dispatched inside event.waitUntil, after the response has been handed to the
 * visitor. A slow or failing PIW costs log rows; it can never delay or break a
 * page load, and missing configuration makes it a no-op rather than an error.
 */
function logArrival(request: NextRequest, event: NextFetchEvent | undefined) {
  if (!event || !shouldLogArrival(request.nextUrl.pathname)) return;

  const endpoint = process.env.ARRIVAL_INGEST_URL;
  const sharedSecret = process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  const visitorSalt = process.env.ARRIVAL_VISITOR_SALT;
  if (!endpoint || !sharedSecret || !visitorSalt) return;

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
}

// Keep this app's routing boundary explicit in the monorepo so deployment
// tooling never inherits the dashboard's root-level authentication proxy.
export default function proxy(request: NextRequest, event?: NextFetchEvent) {
  logArrival(request, event);

  const {pathname} = request.nextUrl;
  if (pathname.endsWith(".html") && !pathname.startsWith("/public-pages/")) {
    const destination = request.nextUrl.clone();
    destination.pathname = `/public-pages${pathname}`;
    return NextResponse.rewrite(destination);
  }

  return NextResponse.next();
}
