import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { LeadConduitEventBatch } from "@/modules/access-route/contracts";
import { getLeadConduitFlowBinding, type LeadConduitFlowBinding } from "@/modules/access-route/leadconduit-config";
import {
  LEADCONDUIT_SHADOW_CHECKPOINT,
  classifyLeadConduitShadow,
  parseLeadConduitShadowPayload,
  toLeadConduitShadowEvent,
} from "@/modules/access-route/leadconduit-shadow-receipt";
import { SupabaseAccessRouteRepository } from "@/modules/access-route/repository";

const MAX_BODY_BYTES = 65_536;

export type LeadConduitShadowRouteDependencies = {
  getBinding(flow: string): LeadConduitFlowBinding | null;
  persist(input: LeadConduitEventBatch): Promise<number>;
  now(): Date;
};

type LeadConduitShadowRouteResult = {
  status: 200 | 400 | 401 | 413 | 503;
  body: Record<string, unknown>;
};

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

function hasValidBearerToken(token: string | null, binding: LeadConduitFlowBinding, now: Date): boolean {
  if (!token) return false;

  const candidateHash = hashToken(token);
  let authenticated = false;
  for (const configuredToken of binding.tokens) {
    const expectedHash = hashToken(configuredToken.value);
    const matched = timingSafeEqual(candidateHash, expectedHash);
    const isCurrent = configuredToken.validUntil === null || new Date(configuredToken.validUntil) > now;
    authenticated = (matched && isCurrent) || authenticated;
  }
  return authenticated;
}

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // The byte limit has already been exceeded; cancellation is best-effort.
      }
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function isJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function hasTrustedBindingMismatch(value: unknown, binding: LeadConduitFlowBinding): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (typeof record.flow_id === "string" && record.flow_id !== binding.flowId)
    || (typeof record.checkpoint === "string" && record.checkpoint !== LEADCONDUIT_SHADOW_CHECKPOINT);
}

export async function handleLeadConduitShadowRequest(
  request: Request,
  flow: string,
  dependencies: LeadConduitShadowRouteDependencies,
): Promise<LeadConduitShadowRouteResult> {
  const binding = dependencies.getBinding(flow);
  if (!binding || !binding.receiptEnabled) {
    return { status: 503, body: { outcome: "retry", category: "disabled" } };
  }

  const now = dependencies.now();
  if (!hasValidBearerToken(extractBearerToken(request), binding, now)) {
    return { status: 401, body: { outcome: "unauthorized" } };
  }

  if (!isJsonContentType(request)) {
    return { status: 400, body: { outcome: "invalid", category: "invalid_payload" } };
  }

  let text: string | null;
  try {
    text = await readBoundedBody(request);
  } catch {
    return { status: 400, body: { outcome: "invalid", category: "invalid_payload" } };
  }
  if (text === null) {
    return { status: 413, body: { outcome: "retry", category: "payload_too_large" } };
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(text);
  } catch {
    return { status: 400, body: { outcome: "invalid", category: "invalid_payload" } };
  }

  if (hasTrustedBindingMismatch(rawPayload, binding)) {
    return { status: 401, body: { outcome: "unauthorized" } };
  }

  const parsed = parseLeadConduitShadowPayload(rawPayload);
  if (!parsed.ok) {
    return {
      status: 400,
      body: { outcome: "invalid", category: "invalid_payload", invalidFields: parsed.invalidFields },
    };
  }

  const observedAt = now.toISOString();
  const event = toLeadConduitShadowEvent({
    binding,
    payload: parsed.value,
    categories: classifyLeadConduitShadow({ flowSlug: binding.slug, payload: parsed.value }),
    observedAt,
  });

  try {
    await dependencies.persist({
      companyId: binding.companyId,
      flowId: binding.flowId,
      channel: "webhook",
      observedAt,
      rows: [event],
    });
  } catch {
    return { status: 503, body: { outcome: "retry", category: "persistence" } };
  }

  return { status: 200, body: { outcome: "success" } };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ flow: string }> },
) {
  const { flow } = await params;
  const environment = parseServerEnv(process.env);

  const result = await handleLeadConduitShadowRequest(request, flow, {
    getBinding: (candidateFlow) => getLeadConduitFlowBinding(candidateFlow, environment),
    persist: async (input) => new SupabaseAccessRouteRepository(createServiceClient()).upsertLeadConduitEvents(input),
    now: () => new Date(),
  });

  return NextResponse.json(result.body, { status: result.status });
}
