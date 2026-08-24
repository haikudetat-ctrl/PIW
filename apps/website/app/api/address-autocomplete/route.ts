import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";

const inputSchema = z.object({
  input: z.string().trim().min(3).max(200),
}).strict();

const googleResponseSchema = z.object({
  suggestions: z.array(z.object({
    placePrediction: z.object({
      placeId: z.string().trim().min(1),
      text: z.object({text: z.string().trim().min(1)}),
    }).optional(),
  })).optional().default([]),
});

type Autocomplete = (input: string) => Promise<Response>;

export async function handleAddressAutocompleteRequest(
  request: NextRequest,
  autocomplete: Autocomplete,
) {
  const parsedInput = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsedInput.success) {
    return NextResponse.json({error: "Enter at least three characters"}, {status: 400});
  }

  const providerResponse = await autocomplete(parsedInput.data.input).catch(() => null);
  if (!providerResponse?.ok) {
    return NextResponse.json({error: "Address search is temporarily unavailable"}, {status: 502});
  }

  const providerBody = await providerResponse.json().catch(() => null);
  const parsedProvider = googleResponseSchema.safeParse(providerBody);
  if (!parsedProvider.success) {
    return NextResponse.json({error: "Address search is temporarily unavailable"}, {status: 502});
  }

  const suggestions = parsedProvider.data.suggestions.flatMap(({placePrediction}) =>
    placePrediction
      ? [{placeId: placePrediction.placeId, address: placePrediction.text.text}]
      : [],
  );
  return NextResponse.json({suggestions});
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({error: "Address search is not configured"}, {status: 503});
  }

  return handleAddressAutocompleteRequest(request, (input) =>
    fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ["us"],
        regionCode: "us",
        languageCode: "en",
        locationBias: {
          rectangle: {
            low: {latitude: 38.8, longitude: -75.6},
            high: {latitude: 41.4, longitude: -73.8},
          },
        },
      }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    }),
  );
}
