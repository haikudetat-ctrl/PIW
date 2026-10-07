import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchGoogleAddressSuggestions,
  type GoogleAddressSuggestion,
} from "@/modules/providers/adapters/google-places";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

// Google address suggestions for the value-first address step, served from
// PIW with the server key so the step never depends on a browser Maps key
// and its referrer restrictions. Only verified tenant hosts get suggestions,
// and only for same-origin requests from that host's own page.
const querySchema = z.object({
  q: z.string().trim().min(3).max(200),
  session_token: z.uuid(),
});

const noStore = {"cache-control": "no-store"};
const json = (body: unknown, status: number) => NextResponse.json(body, {status, headers: noStore});

export async function handlePreviewAddressSuggestionsRequest(
  request: NextRequest,
  dependencies: {
    enabled: boolean;
    resolveCompany(host: string | null): Promise<string | null>;
    suggest(input: {input: string; sessionToken: string}): Promise<GoogleAddressSuggestion[]>;
    reportError?: (error: unknown) => void;
  },
) {
  if (!dependencies.enabled) return json({error: "unavailable"}, 503);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return json({error: "Not found"}, 404);
  if (!await dependencies.resolveCompany(request.headers.get("host"))) return json({error: "Not found"}, 404);

  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q"),
    session_token: request.nextUrl.searchParams.get("session_token"),
  });
  if (!parsed.success) return json({error: "Invalid address query"}, 400);

  try {
    const suggestions = await dependencies.suggest({input: parsed.data.q, sessionToken: parsed.data.session_token});
    return json({suggestions}, 200);
  } catch (error) {
    (dependencies.reportError ?? console.error)(error);
    return json({error: "unavailable"}, 503);
  }
}

export async function GET(request: NextRequest) {
  let environment: ReturnType<typeof parseServerEnv>;
  try {
    environment = parseServerEnv(process.env);
  } catch {
    return json({error: "unavailable"}, 503);
  }
  const mapsKey = environment.GOOGLE_MAPS_API_KEY;
  const lookup = createSupabasePublicHostLookup(createServiceClient());
  return handlePreviewAddressSuggestionsRequest(request, {
    enabled: environment.PROPERTY_PREVIEW_ENABLED && environment.PAID_PROVIDERS_ENABLED && Boolean(mapsKey),
    resolveCompany: async (host) => (await resolvePublicHost(host, lookup))?.companyId ?? null,
    suggest: (input) => fetchGoogleAddressSuggestions({...input, apiKey: mapsKey}),
  });
}
