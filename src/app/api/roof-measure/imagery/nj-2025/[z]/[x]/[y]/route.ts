import {NextResponse} from "next/server";
import {canUseCrm, parseMyAccess} from "@/lib/auth/access";
import {createServerClient} from "@/lib/supabase/server";
import {parseTileRequest} from "@/modules/roof-measure/nj-ortho";
import {ImageryUnavailableError, renderNj2025Tile} from "@/modules/roof-measure/nj-ortho-tiles";

// Map tiles of NJ's 2025 statewide orthoimagery for the staff roof measuring
// page: /api/roof-measure/imagery/nj-2025/{z}/{x}/{y}.jpg at zoom 19 and 20.
// The imagery is public state data, so a rendered tile is marked immutable and
// the CDN may serve it to anyone holding the URL; the sign-in check only stops
// strangers from making the server render new tiles.

export const runtime = "nodejs";

const IMMUTABLE = "public, max-age=604800, s-maxage=31536000, immutable";
const MISSING = "public, max-age=86400, s-maxage=604800";

export async function GET(_request: Request, context: {params: Promise<{z: string; x: string; y: string}>}) {
  const params = await context.params;
  const tile = parseTileRequest(params.z, params.x, params.y);
  if (!tile) return new NextResponse(null, {status: 404, headers: {"cache-control": MISSING}});

  const supabase = await createServerClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, {status: 401, headers: {"cache-control": "no-store"}});
  const {data: accessRows} = await supabase.rpc("get_my_access");
  const access = parseMyAccess(accessRows);
  if (!access || !canUseCrm(access)) return new NextResponse(null, {status: 403, headers: {"cache-control": "no-store"}});

  try {
    const body = await renderNj2025Tile(tile);
    if (!body) return new NextResponse(null, {status: 404, headers: {"cache-control": MISSING}});
    return new NextResponse(new Uint8Array(body), {
      headers: {"content-type": "image/jpeg", "cache-control": IMMUTABLE},
    });
  } catch (error) {
    const status = error instanceof ImageryUnavailableError ? 502 : 500;
    return new NextResponse(null, {status, headers: {"cache-control": "no-store"}});
  }
}
