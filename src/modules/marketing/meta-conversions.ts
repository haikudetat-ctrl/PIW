import "server-only";
import { z } from "zod";
import {
  hashMetaValue,
  normalizeMetaEmail,
  normalizeMetaPhone,
  type MetaDeliverySource,
} from "./meta-events";

const META_REQUEST_TIMEOUT_MS = 8_000;
const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const LOCAL_REJECTION_PAYLOAD_HASH = hashMetaValue("meta-capi-local-rejection-v1");

const successResponseSchema = z.object({
  events_received: z.number().int().nonnegative(),
  fbtrace_id: z.string().optional(),
});

const errorResponseSchema = z.object({
  error: z.object({
    type: z.string().optional(),
    code: z.number().int().optional(),
  }),
});

export type MetaDeliveryResult = {
  outcome: "sent" | "retryable_failed" | "permanent_failed";
  httpStatus: number | null;
  traceId: string | null;
  errorCategory: string | null;
  payloadHash: string;
};

type MetaUserData = {
  em: [string];
  ph: [string];
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
};

export type MetaCapiPayload = {
  data: [{
    event_name: MetaDeliverySource["eventName"];
    event_time: number;
    event_id: string;
    action_source: "website";
    event_source_url: string;
    user_data: MetaUserData;
  }];
};

function canonicalEventSourceUrl(source: MetaDeliverySource): string {
  let url: URL;
  try {
    url = new URL(source.eventSourceUrl);
  } catch {
    throw new Error("Invalid Meta event source URL");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Invalid Meta event source URL");
  }

  if (
    source.eventName === "Lead"
    && (url.hostname === "allseasonsolar.net" || url.hostname === "www.allseasonsolar.net")
  ) {
    return "https://allseasonsolar.net/";
  }
  if (
    source.eventName === "AssessmentCompleted"
    && url.hostname === "piw-sepia.vercel.app"
  ) {
    return "https://piw-sepia.vercel.app/roof-estimate";
  }

  throw new Error("Meta event source URL is not allowlisted");
}

function optionalUserValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function buildMetaCapiPayload(source: MetaDeliverySource): MetaCapiPayload {
  const eventTime = Date.parse(source.eventTime);
  if (!Number.isFinite(eventTime)) throw new Error("Invalid Meta event time");

  const clientIpAddress = optionalUserValue(source.clientIpAddress);
  const clientUserAgent = optionalUserValue(source.clientUserAgent);
  const fbp = optionalUserValue(source.fbp);
  const fbc = optionalUserValue(source.fbc);
  const userData: MetaUserData = {
    em: [hashMetaValue(normalizeMetaEmail(source.email))],
    ph: [hashMetaValue(normalizeMetaPhone(source.phone, "US"))],
    ...(clientIpAddress ? { client_ip_address: clientIpAddress } : {}),
    ...(clientUserAgent ? { client_user_agent: clientUserAgent } : {}),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
  };

  return {
    data: [{
      event_name: source.eventName,
      event_time: Math.floor(eventTime / 1_000),
      event_id: source.eventId,
      action_source: "website",
      event_source_url: canonicalEventSourceUrl(source),
      user_data: userData,
    }],
  };
}

export function classifyMetaResponse(status: number): "retryable" | "permanent" {
  return status === 408 || status === 429 || status >= 500 ? "retryable" : "permanent";
}

function sanitizedToken(value: string | undefined): string | null {
  if (!value) return null;
  const token = value
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
  return token || null;
}

function sanitizedTraceId(value: string | undefined): string | null {
  const traceId = value?.trim();
  return traceId && /^[A-Za-z0-9_-]{1,128}$/.test(traceId) ? traceId : null;
}

function knownErrorType(value: string | undefined): string | null {
  const token = sanitizedToken(value)?.toLowerCase();
  if (!token) return null;
  const compact = token.replace(/_/g, "");
  const knownTypes: Record<string, string> = {
    oauthexception: "oauth_exception",
    graphmethodexception: "graph_method_exception",
    graphqlexception: "graphql_exception",
    facebookapiexception: "facebook_api_exception",
    transientexception: "transient_exception",
    throttledexception: "throttled_exception",
    permissionerror: "permission_error",
  };
  return knownTypes[compact] ?? null;
}

function errorCategory(body: unknown, status: number): string {
  const parsed = errorResponseSchema.safeParse(body);
  if (!parsed.success) return `http_${status}`;

  const type = knownErrorType(parsed.data.error.type);
  const code = parsed.data.error.code === undefined
    ? null
    : sanitizedToken(String(parsed.data.error.code))?.toLowerCase();
  if (type && code) return `meta_${type}:${code}`;
  if (type) return `meta_${type}`;
  if (code) return `meta_error:${code}`;
  return `http_${status}`;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class MetaConversionClient {
  constructor(private readonly config: {
    pixelId: string;
    accessToken: string;
    graphApiVersion: string;
    testEventCode?: string;
    fetchImpl?: typeof fetch;
  }) {}

  async send(source: MetaDeliverySource): Promise<MetaDeliveryResult> {
    if (
      typeof this.config.pixelId !== "string"
      || !/^\d+$/.test(this.config.pixelId)
      || typeof this.config.graphApiVersion !== "string"
      || !/^v\d+\.\d+$/.test(this.config.graphApiVersion)
      || typeof this.config.accessToken !== "string"
      || !this.config.accessToken.trim()
    ) {
      return {
        outcome: "permanent_failed",
        httpStatus: null,
        traceId: null,
        errorCategory: "invalid_config",
        payloadHash: LOCAL_REJECTION_PAYLOAD_HASH,
      };
    }

    let payloadHash: string;
    let requestBody: string;
    try {
      const payload: MetaCapiPayload = buildMetaCapiPayload(source);
      payloadHash = hashMetaValue(JSON.stringify(payload));
      requestBody = JSON.stringify({
        ...payload,
        ...(this.config.testEventCode ? { test_event_code: this.config.testEventCode } : {}),
        access_token: this.config.accessToken,
      });
    } catch {
      return {
        outcome: "permanent_failed",
        httpStatus: null,
        traceId: null,
        errorCategory: "invalid_payload",
        payloadHash: LOCAL_REJECTION_PAYLOAD_HASH,
      };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), META_REQUEST_TIMEOUT_MS);

    try {
      const fetchImpl = this.config.fetchImpl ?? fetch;
      const response = await fetchImpl(
        `${META_GRAPH_ORIGIN}/${this.config.graphApiVersion}/${this.config.pixelId}/events`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
          signal: controller.signal,
        },
      );
      const body = await responseJson(response);

      if (response.ok) {
        const parsed = successResponseSchema.safeParse(body);
        if (parsed.success && parsed.data.events_received > 0) {
          return {
            outcome: "sent",
            httpStatus: response.status,
            traceId: sanitizedTraceId(parsed.data.fbtrace_id),
            errorCategory: null,
            payloadHash,
          };
        }
        return {
          outcome: "permanent_failed",
          httpStatus: response.status,
          traceId: null,
          errorCategory: "invalid_response",
          payloadHash,
        };
      }

      const classification = classifyMetaResponse(response.status);
      return {
        outcome: classification === "retryable" ? "retryable_failed" : "permanent_failed",
        httpStatus: response.status,
        traceId: null,
        errorCategory: errorCategory(body, response.status),
        payloadHash,
      };
    } catch {
      return {
        outcome: "retryable_failed",
        httpStatus: null,
        traceId: null,
        errorCategory: controller.signal.aborted ? "timeout" : "network_error",
        payloadHash,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
