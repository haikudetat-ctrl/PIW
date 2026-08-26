import {afterEach, describe, expect, test, vi} from "vitest";

type GoogleReviewsRoute = {
  GET: (request?: Request) => Promise<Response>;
  createRollingWindowLimiter: (
    maxRequests: number,
    windowMs: number,
    now?: () => number,
  ) => (clientKey: string) => {allowed: boolean; retryAfterSeconds: number};
  handleGoogleReviewsGet: (
    request: Request,
    fetchPlace: () => Promise<Response>,
    rateLimiter: (clientKey: string) => {allowed: boolean; retryAfterSeconds: number},
  ) => Promise<Response>;
  handleGoogleReviewsRequest: (fetchPlace: () => Promise<Response>) => Promise<Response>;
};

async function loadRoute() {
  const modulePath = "./route";
  return import(/* @vite-ignore */ modulePath)
    .then((route) => route as GoogleReviewsRoute)
    .catch(() => null);
}

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_PLACE_ID;
  vi.unstubAllGlobals();
});

describe("Google reviews feed", () => {
  test("returns display-ready Google review data for the homepage marquee", async () => {
    const route = await loadRoute();
    expect(route, "the Google reviews route should exist").not.toBeNull();
    if (!route) return;

    const response = await route.handleGoogleReviewsRequest(async () => Response.json({
      displayName: {text: "All Season Solar", languageCode: "en"},
      rating: 4.8,
      userRatingCount: 214,
      googleMapsUri: "https://maps.google.com/?cid=123",
      attributions: [
        {provider: "Example Data One", providerUri: "https://provider-one.example/"},
        {provider: "Example Data Two", providerUri: "https://provider-two.example/"},
      ],
      reviews: [{
        name: "places/example/reviews/review-1",
        relativePublishTimeDescription: "2 weeks ago",
        rating: 5,
        text: {text: "The roofing crew was careful, clean, and communicative.", languageCode: "en"},
        originalText: {text: "The roofing crew was careful, clean, and communicative.", languageCode: "en"},
        authorAttribution: {
          displayName: "Morgan R.",
          uri: "https://www.google.com/maps/contrib/123",
          photoUri: "https://lh3.googleusercontent.com/example",
        },
        publishTime: "2026-08-01T12:00:00Z",
        googleMapsUri: "https://www.google.com/maps/reviews/data=review-1",
      }],
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      businessName: "All Season Solar",
      rating: 4.8,
      reviewCount: 214,
      googleMapsUri: "https://maps.google.com/?cid=123",
      attributions: [
        {provider: "Example Data One", providerUri: "https://provider-one.example/"},
        {provider: "Example Data Two", providerUri: "https://provider-two.example/"},
      ],
      reviews: [{
        author: "Morgan R.",
        authorUri: "https://www.google.com/maps/contrib/123",
        photoUri: "https://lh3.googleusercontent.com/example",
        rating: 5,
        text: "The roofing crew was careful, clean, and communicative.",
        relativeTime: "2 weeks ago",
        reviewUri: "https://www.google.com/maps/reviews/data=review-1",
      }],
    });
  });

  test("discards reviews without complete Google author and direct-review attribution", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;

    const completeReview = {
      rating: 5,
      text: {text: "The crew protected our home and kept us informed."},
      relativePublishTimeDescription: "a month ago",
      googleMapsUri: "https://www.google.com/maps/reviews/data=complete",
      authorAttribution: {
        displayName: "Jamie L.",
        uri: "https://www.google.com/maps/contrib/complete",
      },
    };
    const response = await route.handleGoogleReviewsRequest(async () => Response.json({
      displayName: {text: "All Season Solar"},
      rating: 4.8,
      userRatingCount: 214,
      googleMapsUri: "https://maps.google.com/?cid=123",
      attributions: [],
      reviews: [
        completeReview,
        {...completeReview, googleMapsUri: undefined},
        {...completeReview, authorAttribution: {...completeReview.authorAttribution, uri: undefined}},
        {...completeReview, authorAttribution: undefined},
      ],
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reviews: [{
        author: "Jamie L.",
        authorUri: "https://www.google.com/maps/contrib/complete",
        reviewUri: "https://www.google.com/maps/reviews/data=complete",
      }],
    });
  });

  test("returns a gateway error instead of fabricating reviews when Google fails", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;

    const response = await route
      .handleGoogleReviewsRequest(async () => new Response(null, {status: 429}))
      .catch(() => null);

    expect(response, "provider failures should become a stable HTTP response").not.toBeNull();
    if (!response) return;
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Google reviews are temporarily unavailable",
    });
  });

  test.each([
    ["the provider request rejects", async () => { throw new Error("network down"); }],
    ["the provider returns malformed data", async () => Response.json({reviews: "invalid"})],
  ])("returns the stable gateway error when %s", async (_case, fetchPlace) => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;

    const response = await route.handleGoogleReviewsRequest(fetchPlace).catch(() => null);

    expect(response, "provider failures should not escape the route").not.toBeNull();
    if (!response) return;
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Google reviews are temporarily unavailable",
    });
  });

  test("requires server-side Google Places credentials", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;
    expect(typeof route.GET, "the public feed should expose a GET handler").toBe("function");
    if (typeof route.GET !== "function") return;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const response = await route.GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Google reviews are not configured",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("loads the configured place through the server-side Places Details API", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;
    process.env.GOOGLE_PLACES_API_KEY = "server-side-key";
    process.env.GOOGLE_PLACES_PLACE_ID = "ChIJ45RSnZvmwIkRTKQQ-sW_09k";
    const fetch = vi.fn(async () => Response.json({
      displayName: {text: "All Season Solar"},
      rating: 4.9,
      userRatingCount: 300,
      googleMapsUri: "https://maps.google.com/?cid=123",
      attributions: [],
      reviews: [],
    }));
    vi.stubGlobal("fetch", fetch);

    const response = await route.GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      businessName: "All Season Solar",
      rating: 4.9,
      reviewCount: 300,
      googleMapsUri: "https://maps.google.com/?cid=123",
      attributions: [],
      reviews: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places/ChIJ45RSnZvmwIkRTKQQ-sW_09k",
      expect.objectContaining({
        headers: {
          "x-goog-api-key": "server-side-key",
          "x-goog-fieldmask": "displayName,rating,userRatingCount,googleMapsUri,reviews,attributions",
        },
      }),
    );
    expect(JSON.stringify(body)).not.toContain("server-side-key");
  });

  test("does not cache Google review content at either request boundary", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;
    process.env.GOOGLE_PLACES_API_KEY = "server-side-key";
    process.env.GOOGLE_PLACES_PLACE_ID = "ChIJ45RSnZvmwIkRTKQQ-sW_09k";
    const fetch = vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
      void args;
      return Response.json({
        displayName: {text: "All Season Solar"},
        rating: 4.9,
        userRatingCount: 300,
        googleMapsUri: "https://maps.google.com/?cid=123",
        attributions: [],
        reviews: [],
      });
    });
    vi.stubGlobal("fetch", fetch);

    const response = await route.GET();

    expect(response.headers.get("cache-control")).toBe("no-store");
    const requestOptions = fetch.mock.calls[0]?.[1];
    expect(requestOptions).toMatchObject({cache: "no-store"});
    expect(requestOptions).not.toHaveProperty("next");
  });

  test("blocks the excess request until the rolling window expires", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;
    let currentTime = 10_000;
    const limiter = route.createRollingWindowLimiter(2, 60_000, () => currentTime);

    expect(limiter("203.0.113.5")).toEqual({allowed: true, retryAfterSeconds: 0});
    expect(limiter("203.0.113.5")).toEqual({allowed: true, retryAfterSeconds: 0});
    expect(limiter("203.0.113.5")).toEqual({allowed: false, retryAfterSeconds: 60});
    expect(limiter("198.51.100.7")).toEqual({allowed: true, retryAfterSeconds: 0});

    currentTime += 60_001;
    expect(limiter("203.0.113.5")).toEqual({allowed: true, retryAfterSeconds: 0});
  });

  test("returns 429 before another Google request is made", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;
    const limiter = route.createRollingWindowLimiter(1, 60_000, () => 20_000);
    let providerCalls = 0;
    const fetchPlace = async () => {
      providerCalls += 1;
      return Response.json({
        displayName: {text: "All Season Solar"},
        rating: 4.9,
        userRatingCount: 300,
        googleMapsUri: "https://maps.google.com/?cid=123",
        attributions: [],
        reviews: [],
      });
    };
    const request = new Request("https://allseason.example/api/google-reviews", {
      headers: {"x-vercel-forwarded-for": "203.0.113.8"},
    });

    expect((await route.handleGoogleReviewsGet(request, fetchPlace, limiter)).status).toBe(200);
    const limited = await route.handleGoogleReviewsGet(request, fetchPlace, limiter);

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    await expect(limited.json()).resolves.toEqual({
      error: "Too many Google review requests",
    });
    expect(providerCalls).toBe(1);
  });
});
