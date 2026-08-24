import {afterEach, describe, expect, test, vi} from "vitest";
import {GET, handleGoogleReviewsRequest} from "./route";

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_PLACE_ID;
  delete process.env.GOOGLE_MAPS_API_KEY;
  vi.unstubAllGlobals();
});

describe("Google reviews feed", () => {
  test("returns only display-ready review data with Google attribution links", async () => {
    const response = await handleGoogleReviewsRequest(async () => new Response(JSON.stringify({
      displayName: {text: "All Season Solar", languageCode: "en"},
      rating: 4.8,
      userRatingCount: 214,
      googleMapsUri: "https://maps.google.com/?cid=123",
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
    }), {status: 200}));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      businessName: "All Season Solar",
      rating: 4.8,
      reviewCount: 214,
      googleMapsUri: "https://maps.google.com/?cid=123",
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

  test("returns a gateway error instead of stale or fabricated reviews when Google fails", async () => {
    const response = await handleGoogleReviewsRequest(async () => new Response(null, {status: 429}));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({error: "Google reviews are temporarily unavailable"});
  });

  test("requires server-side Google Places credentials", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error: "Google reviews are not configured"});
    expect(fetch).not.toHaveBeenCalled();
  });

  test("uses the verified All Season Solar place when no override is configured", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "server-side-key";
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      if (String(input) !== "https://places.googleapis.com/v1/places/ChIJ45RSnZvmwIkRTKQQ-sW_09k") {
        return new Response(null, {status: 404});
      }
      return new Response(JSON.stringify({displayName: {text: "All Season Solar"}, reviews: []}));
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect((await response.json()).businessName).toBe("All Season Solar");
  });
});
