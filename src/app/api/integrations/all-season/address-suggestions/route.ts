import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env/server";
import {
  fetchGoogleAddressSuggestions,
  type GoogleAddressSuggestion,
} from "@/modules/providers/adapters/google-places";
import { allSeasonSecretsMatch } from "@/modules/leads/all-season-intake-secret";

const querySchema = z.object({
  q: z.string().trim().min(3).max(200),
  session_token: z.uuid(),
});

type Dependencies = {
  expectedSecret: string;
  suggest: (input: {
    input: string;
    sessionToken: string;
  }) => Promise<GoogleAddressSuggestion[]>;
  reportError?: (error: unknown) => void;
};

export async function handleAllSeasonAddressSuggestionsRequest(
  request: NextRequest,
  dependencies: Dependencies,
) {
  const providedSecret = request.headers.get("x-all-season-intake-secret") ?? "";
  if (!allSeasonSecretsMatch(providedSecret, dependencies.expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q"),
    session_token: request.nextUrl.searchParams.get("session_token"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid address query" }, { status: 400 });
  }
  try {
    const suggestions = await dependencies.suggest({
      input: parsed.data.q,
      sessionToken: parsed.data.session_token,
    });
    return NextResponse.json({ suggestions }, { status: 200 });
  } catch (error) {
    (dependencies.reportError ?? console.error)(error);
    return NextResponse.json({ error: "Address suggestions are temporarily unavailable" }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const environment = parseServerEnv(process.env);
  if (!environment.ALL_SEASON_INTAKE_SHARED_SECRET || !environment.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json({ error: "Address suggestions are not configured" }, { status: 503 });
  }
  return handleAllSeasonAddressSuggestionsRequest(request, {
    expectedSecret: environment.ALL_SEASON_INTAKE_SHARED_SECRET,
    suggest: (input) => fetchGoogleAddressSuggestions({
      ...input,
      apiKey: environment.GOOGLE_MAPS_API_KEY,
    }),
  });
}
