import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { parseClientEnv } from "@/lib/env/client";
import { recordEstimateArrival, shouldLogEstimateArrival } from "@/modules/marketing/estimate-arrivals";
import { isTenantPublicPath, normalizeHost, parseTenantHosts } from "@/modules/tenancy/public-host";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/auth/confirm",
  "/auth/email-action",
  "/forgot-password",
  "/reset-password",
  "/roof-estimate",
  "/privacy",
];
const PUBLIC_ASSET_PATHS = new Set([
  "/campaigns/for-every-season/hero.webp",
  "/campaigns/weather-report/hero.webp",
  "/campaigns/seasonal-shield/hero.webp",
  "/brand/all-season-mark.svg",
]);

export function isPublicPath(pathname: string) {
  return PUBLIC_ASSET_PATHS.has(pathname)
    || PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function logEstimateArrival(request: NextRequest, host: string, event: NextFetchEvent | undefined) {
  if (!event || !shouldLogEstimateArrival(request)) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;
  // Dispatched after the response: a slow or failing insert never delays the page.
  event.waitUntil(recordEstimateArrival(request, host, {
    client: createClient<Database>(url, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}}),
    environment: process.env,
  }));
}

export async function middleware(request: NextRequest, event?: NextFetchEvent) {
  // Tenant estimate hosts serve only the public estimate experience. They never
  // reach the staff app or its session handling, so a customer-branded domain
  // cannot expose PIW.
  const host = normalizeHost(request.headers.get("host"));
  if (host && parseTenantHosts(process.env.PUBLIC_ESTIMATE_HOSTS).has(host)) {
    if (!isTenantPublicPath(request.nextUrl.pathname)) return new NextResponse(null, { status: 404 });
    logEstimateArrival(request, host, event);
    return NextResponse.next({ request });
  }

  // API routes authenticate themselves (Supabase session or Inngest signing
  // key) and must return REST status codes, not an HTML redirect to /login.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const env = parseClientEnv({
    DEPLOYMENT_ENV: process.env.DEPLOYMENT_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
