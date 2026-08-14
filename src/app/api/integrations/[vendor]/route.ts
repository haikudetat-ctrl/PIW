import { NextResponse } from "next/server";
import {
  isGenericWebhookVendor,
  isIntegrationVendor,
} from "@/lib/integrations/flags";

export type IntegrationWebhookResult = {
  status: 400 | 503;
  body: Record<string, unknown>;
};

// Generic vendor webhooks cannot be tenant-bound safely. LeadMaster and
// JobNimbus remain read-only scheduled integrations, and CallTools remains
// disabled until a vendor-specific, tenant-bound receiver is designed.
export function handleIntegrationWebhookRequest(vendor: string): IntegrationWebhookResult {
  if (!isIntegrationVendor(vendor)) {
    return { status: 400, body: { error: "Unknown integration vendor" } };
  }

  if (!isGenericWebhookVendor(vendor)) {
    return { status: 400, body: { error: "Unsupported integration vendor" } };
  }

  return { status: 503, body: { error: "Integration disabled" } };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ vendor: string }> },
) {
  const { vendor } = await params;
  const result = handleIntegrationWebhookRequest(vendor);
  return NextResponse.json(result.body, { status: result.status });
}
