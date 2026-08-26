import {NextResponse} from "next/server";
import {z} from "zod";

const attributionSchema = z.object({
  provider: z.string().trim().min(1),
  providerUri: z.url(),
});

const googlePlaceSchema = z.object({
  displayName: z.object({text: z.string().trim().min(1)}),
  rating: z.number().min(0).max(5),
  userRatingCount: z.number().int().nonnegative(),
  googleMapsUri: z.url(),
  attributions: z.array(attributionSchema).optional().default([]),
  reviews: z.array(z.object({
    rating: z.number().int().min(1).max(5),
    text: z.object({text: z.string().trim().min(1)}).optional(),
    relativePublishTimeDescription: z.string().trim().optional(),
    googleMapsUri: z.url().optional(),
    authorAttribution: z.object({
      displayName: z.string().trim().min(1).optional(),
      uri: z.url().optional(),
      photoUri: z.url().optional(),
    }).optional(),
  })).optional().default([]),
});

const noStoreHeaders = {"Cache-Control": "no-store"};
const rateLimitWindowMs = 60_000;
const rateLimitRequests = 10;
const maxTrackedClients = 5_000;

type RateLimitDecision = {allowed: boolean; retryAfterSeconds: number};
type RateLimiter = (clientKey: string) => RateLimitDecision;

export function createRollingWindowLimiter(
  maxRequests: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const requestsByClient = new Map<string, number[]>();

  return (clientKey) => {
    const currentTime = now();
    const windowStart = currentTime - windowMs;
    const recentRequests = (requestsByClient.get(clientKey) ?? [])
      .filter((timestamp) => timestamp > windowStart);

    if (recentRequests.length >= maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((recentRequests[0] + windowMs - currentTime) / 1_000),
      );
      requestsByClient.set(clientKey, recentRequests);
      return {allowed: false, retryAfterSeconds};
    }

    if (!requestsByClient.has(clientKey) && requestsByClient.size >= maxTrackedClients) {
      const oldestClient = requestsByClient.keys().next().value;
      if (oldestClient) requestsByClient.delete(oldestClient);
    }
    recentRequests.push(currentTime);
    requestsByClient.set(clientKey, recentRequests);
    return {allowed: true, retryAfterSeconds: 0};
  };
}

// Best-effort protection for each warm function instance. Replicas do not share
// this state, so this reduces accidental/provider abuse but is not a security boundary.
const googleReviewsRateLimiter = createRollingWindowLimiter(
  rateLimitRequests,
  rateLimitWindowMs,
);

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  return forwarded.split(",", 1)[0]?.trim().slice(0, 100) || "unknown";
}

function providerError() {
  return NextResponse.json(
    {error: "Google reviews are temporarily unavailable"},
    {status: 502, headers: noStoreHeaders},
  );
}

export async function handleGoogleReviewsRequest(fetchPlace: () => Promise<Response>) {
  const providerResponse = await fetchPlace().catch(() => null);
  if (!providerResponse?.ok) {
    return providerError();
  }

  const providerBody = await providerResponse.json().catch(() => null);
  const parsedPlace = googlePlaceSchema.safeParse(providerBody);
  if (!parsedPlace.success) {
    return providerError();
  }
  const place = parsedPlace.data;

  return NextResponse.json({
    businessName: place.displayName.text,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    googleMapsUri: place.googleMapsUri,
    attributions: place.attributions,
    reviews: place.reviews.flatMap((review) => {
      const author = review.authorAttribution;
      if (!review.text || !review.googleMapsUri || !author?.displayName || !author.uri) {
        return [];
      }

      return [{
        author: author.displayName,
        authorUri: author.uri,
        photoUri: author.photoUri,
        rating: review.rating,
        text: review.text.text,
        relativeTime: review.relativePublishTimeDescription,
        reviewUri: review.googleMapsUri,
      }];
    }),
  }, {headers: noStoreHeaders});
}

export async function handleGoogleReviewsGet(
  request: Request,
  fetchPlace: () => Promise<Response>,
  rateLimiter: RateLimiter = googleReviewsRateLimiter,
) {
  const decision = rateLimiter(clientKey(request));
  if (!decision.allowed) {
    return NextResponse.json(
      {error: "Too many Google review requests"},
      {
        status: 429,
        headers: {
          ...noStoreHeaders,
          "Retry-After": String(decision.retryAfterSeconds),
        },
      },
    );
  }

  return handleGoogleReviewsRequest(fetchPlace);
}

export async function GET(
  request: Request = new Request("http://localhost/api/google-reviews"),
) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACES_PLACE_ID;
  if (!apiKey || !placeId) {
    return NextResponse.json(
      {error: "Google reviews are not configured"},
      {status: 503, headers: noStoreHeaders},
    );
  }

  return handleGoogleReviewsGet(request, () =>
    fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask": "displayName,rating,userRatingCount,googleMapsUri,reviews,attributions",
      },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    }),
  );
}
