import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createEventEnvelope } from "@/domain/events";
import { parseServerEnv } from "@/lib/env/server";
import {
  isIntegrationEnabled,
  isGenericWebhookVendor,
  isIntegrationVendor,
  type GenericWebhookVendor,
  type IntegrationVendor,
} from "@/lib/integrations/flags";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { recordIntegrationEvent } from "@/modules/integrations/record-integration-event";

export type IntegrationWebhookInput = {
  vendor: string;
  sharedSecret: string | null;
  rawBody: unknown;
  vendorEventId: string | null;
};

export type IntegrationWebhookDependencies = {
  isVendorEnabled: (vendor: GenericWebhookVendor) => boolean;
  expectedSharedSecret: string | undefined;
  getCompanyId: () => Promise<string>;
  recordEvent: (input: {
    companyId: string;
    sourceSystem: string;
    eventType: string;
    idempotencyKey: string;
    rawPayload: Record<string, unknown>;
  }) => Promise<{ eventId: string; isDuplicate: boolean }>;
  enqueueIntegrationEventReceived: (input: {
    companyId: string;
    integrationEventId: string;
    sourceSystem: string;
    eventType: string;
  }) => Promise<void>;
};

export type IntegrationWebhookResult = {
  status: 200 | 400 | 401 | 503;
  body: Record<string, unknown>;
};

function extractEventType(rawBody: unknown): string {
  if (rawBody && typeof rawBody === "object" && "event_type" in rawBody) {
    const value = (rawBody as Record<string, unknown>).event_type;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "unknown";
}

function extractVendorEventId(rawBody: unknown, headerValue: string | null): string | null {
  if (headerValue) return headerValue;
  if (rawBody && typeof rawBody === "object") {
    const record = rawBody as Record<string, unknown>;
    const candidate = record.event_id ?? record.id;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function deriveIdempotencyKey(vendor: string, vendorEventId: string | null, rawBody: unknown): string {
  if (vendorEventId) return `${vendor}:${vendorEventId}`;
  const hash = crypto.createHash("sha256").update(JSON.stringify(rawBody ?? {})).digest("hex");
  return `${vendor}:sha256:${hash}`;
}

// Generic, vendor-agnostic ingestion: verify → record (idempotent) → 2xx →
// hand off async processing to Inngest. No vendor-specific parsing lives
// here — that's Stage 2, once a real vendor's payload shape is known.
export async function handleIntegrationWebhookRequest(
  input: IntegrationWebhookInput,
  deps: IntegrationWebhookDependencies,
): Promise<IntegrationWebhookResult> {
  if (!isIntegrationVendor(input.vendor)) {
    return { status: 400, body: { error: "Unknown integration vendor" } };
  }

  // LeadConduit webhooks are tenant-bound and flow-bound. They cannot use
  // this generic route because it resolves an unsafe primary-company tenant.
  if (!isGenericWebhookVendor(input.vendor)) {
    return { status: 400, body: { error: "Unsupported integration vendor" } };
  }

  if (!deps.isVendorEnabled(input.vendor)) {
    return { status: 503, body: { error: "Integration disabled" } };
  }

  if (!deps.expectedSharedSecret || input.sharedSecret !== deps.expectedSharedSecret) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const eventType = extractEventType(input.rawBody);
  const vendorEventId = extractVendorEventId(input.rawBody, input.vendorEventId);
  const idempotencyKey = deriveIdempotencyKey(input.vendor, vendorEventId, input.rawBody);
  const companyId = await deps.getCompanyId();

  const { eventId, isDuplicate } = await deps.recordEvent({
    companyId,
    sourceSystem: input.vendor,
    eventType,
    idempotencyKey,
    rawPayload: (input.rawBody ?? {}) as Record<string, unknown>,
  });

  // Duplicate deliveries still return success — the vendor's retry should
  // not keep firing, and no second downstream event is enqueued.
  if (!isDuplicate) {
    await deps.enqueueIntegrationEventReceived({
      companyId,
      integrationEventId: eventId,
      sourceSystem: input.vendor,
      eventType,
    });
  }

  return { status: 200, body: { eventId, duplicate: isDuplicate } };
}

async function getPrimaryCompanyId(client: ReturnType<typeof createServiceClient>): Promise<string> {
  const { data, error } = await client.from("companies").select("id").limit(1).single();
  if (error || !data) throw new Error("No company configured");
  return data.id;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vendor: string }> },
) {
  const { vendor } = await params;
  const rawBody = await request.json().catch(() => null);
  const env = parseServerEnv(process.env);
  const client = createServiceClient();

  const result = await handleIntegrationWebhookRequest(
    {
      vendor,
      sharedSecret: request.headers.get("x-piw-webhook-secret"),
      rawBody,
      vendorEventId: request.headers.get("x-piw-event-id"),
    },
    {
      isVendorEnabled: (v) => isIntegrationEnabled(v, process.env),
      expectedSharedSecret: env.INTEGRATIONS_WEBHOOK_SHARED_SECRET,
      getCompanyId: () => getPrimaryCompanyId(client),
      recordEvent: (event) => recordIntegrationEvent(event, client),
      enqueueIntegrationEventReceived: async ({
        companyId,
        integrationEventId,
        sourceSystem,
        eventType,
      }) => {
        const event = createEventEnvelope({
          name: "integration/event.received",
          correlationId: crypto.randomUUID(),
          data: { integrationEventId, sourceSystem, eventType },
        });
        const repository = new SupabaseOutboxRepository(client);
        await repository.enqueue(event, companyId);
      },
    },
  );

  return NextResponse.json(result.body, { status: result.status });
}
