import {NextResponse} from "next/server";

type LoadPlaceDetails = () => Promise<Response>;
const ALL_SEASON_SOLAR_PLACE_ID = "ChIJ45RSnZvmwIkRTKQQ-sW_09k";

type GooglePlace = {
  displayName?: {text?: string};
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: Array<{
    authorAttribution?: {displayName?: string; uri?: string; photoUri?: string};
    rating?: number;
    text?: {text?: string};
    relativePublishTimeDescription?: string;
    googleMapsUri?: string;
  }>;
};

export async function handleGoogleReviewsRequest(loadPlaceDetails: LoadPlaceDetails) {
  const upstream = await loadPlaceDetails().catch(() => null);
  if (!upstream?.ok) {
    return NextResponse.json(
      {error: "Google reviews are temporarily unavailable"},
      {status: 502},
    );
  }

  const place = await upstream.json() as GooglePlace;
  return NextResponse.json({
    businessName: place.displayName?.text ?? "All Season Solar",
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? 0,
    googleMapsUri: place.googleMapsUri ?? null,
    reviews: (place.reviews ?? []).flatMap((review) => {
      const text = review.text?.text?.trim();
      if (!text) return [];
      return [{
        author: review.authorAttribution?.displayName ?? "Google reviewer",
        authorUri: review.authorAttribution?.uri ?? null,
        photoUri: review.authorAttribution?.photoUri ?? null,
        rating: review.rating ?? 0,
        text,
        relativeTime: review.relativePublishTimeDescription ?? "",
        reviewUri: review.googleMapsUri ?? place.googleMapsUri ?? null,
      }];
    }),
  }, {
    headers: {"Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"},
  });
}

export async function GET() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  const placeId = process.env.GOOGLE_PLACES_PLACE_ID ?? ALL_SEASON_SOLAR_PLACE_ID;
  if (!apiKey) {
    return NextResponse.json({error: "Google reviews are not configured"}, {status: 503});
  }

  return handleGoogleReviewsRequest(() => fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "displayName",
          "rating",
          "userRatingCount",
          "googleMapsUri",
          "reviews.authorAttribution",
          "reviews.rating",
          "reviews.text",
          "reviews.relativePublishTimeDescription",
          "reviews.googleMapsUri",
        ].join(","),
      },
      next: {revalidate: 3600},
    },
  ));
}
