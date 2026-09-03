import {NextResponse, type NextRequest} from "next/server";

// Keep this app's routing boundary explicit in the monorepo so deployment
// tooling never inherits the dashboard's root-level authentication proxy.
export default function proxy(request: NextRequest) {
  const {pathname} = request.nextUrl;
  if (pathname.endsWith(".html") && !pathname.startsWith("/public-pages/")) {
    const destination = request.nextUrl.clone();
    destination.pathname = `/public-pages${pathname}`;
    return NextResponse.rewrite(destination);
  }

  return NextResponse.next();
}
