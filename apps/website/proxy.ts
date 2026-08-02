import {NextRequest, NextResponse} from "next/server";

// Keep this app's routing boundary explicit in the monorepo so deployment
// tooling never inherits the dashboard's root-level authentication proxy.
export default function proxy(request: NextRequest) {
  return NextResponse.next();
}
