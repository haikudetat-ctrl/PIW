import { NextResponse } from "next/server";
import {
  integrationFlagsSnapshot,
  leadConduitCapabilityFlagsSnapshot,
} from "@/lib/integrations/flags";

// Reliability framework requirement: every ingestion endpoint exposes a
// health check. No secrets are returned, only which vendors are enabled.
export async function GET() {
  return NextResponse.json({
    status: "ok",
    vendors: integrationFlagsSnapshot(process.env),
    leadconduit: leadConduitCapabilityFlagsSnapshot(process.env),
  });
}
