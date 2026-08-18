import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";

const requestSchema = z.object({
  q: z.string().trim().min(3).max(200),
  session_token: z.uuid(),
});

const responseSchema = z.object({
  suggestions: z.array(z.object({
    placeId: z.string().min(1),
    address: z.string().min(1),
  })).max(5),
});

type ForwardSuggestions = (input: {
  query: string;
  sessionToken: string;
}) => Promise<Response>;

export async function handleAddressSuggestionsRequest(
  request: NextRequest,
  forward: ForwardSuggestions,
) {
  const parsed = requestSchema.safeParse({
    q: request.nextUrl.searchParams.get("q"),
    session_token: request.nextUrl.searchParams.get("session_token"),
  });
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid address query"}, {status: 400});
  }
  const upstream = await forward({
    query: parsed.data.q,
    sessionToken: parsed.data.session_token,
  }).catch(() => null);
  if (!upstream?.ok) {
    return NextResponse.json({error: "Address suggestions are temporarily unavailable"}, {status: 502});
  }
  const suggestions = responseSchema.safeParse(await upstream.json().catch(() => null));
  if (!suggestions.success) {
    return NextResponse.json({error: "Address suggestions are temporarily unavailable"}, {status: 502});
  }
  return NextResponse.json(suggestions.data, {status: 200});
}

export async function GET(request: NextRequest) {
  const suggestionsUrl = process.env.INTAKE_ADDRESS_SUGGESTIONS_URL;
  if (!suggestionsUrl) {
    return NextResponse.json({error: "Address suggestions are not configured"}, {status: 503});
  }
  return handleAddressSuggestionsRequest(request, ({query, sessionToken}) => {
    const url = new URL(suggestionsUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("session_token", sessionToken);
    return fetch(url.toString(), {
      headers: process.env.INTAKE_WEBHOOK_SHARED_SECRET
        ? {"x-all-season-intake-secret": process.env.INTAKE_WEBHOOK_SHARED_SECRET}
        : {},
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
  });
}
