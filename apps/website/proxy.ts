import {NextResponse} from "next/server";

// Keep this app's routing boundary explicit in the monorepo so deployment
// tooling never inherits the dashboard's root-level authentication proxy.
export function proxy() {
  return NextResponse.next();
}
