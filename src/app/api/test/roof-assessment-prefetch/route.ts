import {NextResponse} from "next/server";
import {
  isFakePlaceDetailsTestMode,
  readFakePlaceDetailsDiagnostics,
  resetFakePlaceDetailsDiagnostics,
} from "@/modules/roof-assessment/testing/fake-place-details";

function unavailable() {
  return NextResponse.json({error: "Not found"}, {status: 404});
}

export async function GET() {
  if (!isFakePlaceDetailsTestMode(process.env)) return unavailable();
  return NextResponse.json(readFakePlaceDetailsDiagnostics(), {
    headers: {"cache-control": "no-store"},
  });
}

export async function DELETE() {
  if (!isFakePlaceDetailsTestMode(process.env)) return unavailable();
  resetFakePlaceDetailsDiagnostics();
  return new NextResponse(null, {status: 204, headers: {"cache-control": "no-store"}});
}
