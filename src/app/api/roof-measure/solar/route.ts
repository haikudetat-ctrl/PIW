import {NextResponse} from "next/server";
import {canUseCrm, parseMyAccess} from "@/lib/auth/access";
import {createServerClient} from "@/lib/supabase/server";
import {liveSolarCallLimiter} from "@/modules/roof-measure/live-call-limit";
import {defaultCacheDir, LiveCallLimitError, runDevRoofLookup, type SolarQuality} from "./lookup";

// Roof lookups for the staff measuring page (/roof-measure). Middleware lets
// /api through, so this route checks the session itself: signed-in CRM users
// (Manager and above) only, because every uncached call spends the paid
// Google key.

const qualities: SolarQuality[] = ["HIGH", "MEDIUM", "LOW"];

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  const {data: accessRows} = await supabase.rpc("get_my_access");
  const access = parseMyAccess(accessRows);
  if (!access || !canUseCrm(access)) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const apiKey = process.env.ROOF_MEASURE_GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({error: "ROOF_MEASURE_GOOGLE_API_KEY is not set, so roof lookups are off. Add it in Vercel and redeploy."}, {status: 503});
  }
  const params = new URL(request.url).searchParams;
  const coordinate = (name: string) => {
    const value = params.get(name)?.trim();
    return value && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const quality = qualities.find((value) => value === params.get("quality")) ?? "HIGH";
  try {
    const result = await runDevRoofLookup(
      {
        apiKey,
        fetch,
        cacheDir: defaultCacheDir(),
        allowLiveSolarCall: () => liveSolarCallLimiter.tryConsume(user.id),
      },
      {
        address: params.get("address"),
        lat: coordinate("lat"),
        lng: coordinate("lng"),
        quality,
      },
    );
    return NextResponse.json(result, {headers: {"cache-control": "no-store"}});
  } catch (error) {
    if (error instanceof LiveCallLimitError) {
      return NextResponse.json({error: error.message}, {status: 429});
    }
    const message = error instanceof Error ? error.message : "Lookup failed";
    return NextResponse.json({error: message.replaceAll(apiKey, "[key]")}, {status: 502});
  }
}
