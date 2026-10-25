import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Minimal Google Ads REST client: OAuth refresh, click conversion upload,
 * conversion adjustments (retractions) and GAQL searchStream. Server only;
 * the access token and request bodies are never logged.
 *
 * API version is pinned by GOOGLE_ADS_API_VERSION (for example "v26"). Check
 * Google's sunset schedule before it expires and validate a new version in
 * dry run before switching.
 */

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADS_ORIGIN = "https://googleads.googleapis.com";
const REQUEST_TIMEOUT_MS = 15_000;

export type GoogleAdsCredentials = {
  apiVersion: string;
  oauth: {clientId: string; clientSecret: string; refreshToken: string};
  developerToken: string | null;
};

export type ClickConversion = {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  conversionAction: string;
  conversionDateTime: string;
  conversionValue?: number;
  currencyCode?: string;
  orderId: string;
  userIdentifiers?: Array<{hashedEmail: string} | {hashedPhoneNumber: string}>;
  consent: {adUserData: "GRANTED" | "DENIED"};
};

export type ConversionRetraction = {
  conversionAction: string;
  adjustmentType: "RETRACTION";
  orderId: string;
  adjustmentDateTime: string;
};

export type GoogleAdsCallResult =
  | {outcome: "ok"; httpStatus: number; requestId: string | null; body: unknown}
  | {outcome: "retryable_failed" | "permanent_failed"; httpStatus: number | null; requestId: string | null; errorCategory: string}
  | {outcome: "duplicate"; httpStatus: number; requestId: string | null; errorCategory: string};

const tokenResponseSchema = z.object({access_token: z.string().min(1), expires_in: z.number().optional()});

/** Google's conversion date format: "yyyy-mm-dd hh:mm:ss+00:00". */
export function googleAdsDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid conversion time");
  return `${date.toISOString().slice(0, 19).replace("T", " ")}+00:00`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Google's enhanced conversions normalization: trim and lowercase, and for
 * gmail.com / googlemail.com drop dots in the local part.
 */
export function normalizeGoogleEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const match = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.exec(normalized);
  if (!match) return null;
  const [, local, domain] = match;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "")}@${domain}`;
  }
  return normalized;
}

export function normalizeGooglePhone(phoneE164: string | null): string | null {
  return phoneE164 && /^\+[1-9]\d{7,14}$/.test(phoneE164) ? phoneE164 : null;
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500 || status === 401 || status === 403;
}

/** "conversionUploadError:CLICK_NOT_FOUND" from a GoogleAdsFailure, else null. */
export function firstGoogleAdsErrorCode(body: unknown): string | null {
  const seen = new Set<unknown>();
  function walk(node: unknown): string | null {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.errorCode && typeof record.errorCode === "object") {
      const [key, code] = Object.entries(record.errorCode as Record<string, unknown>)[0] ?? [];
      if (typeof key === "string" && typeof code === "string") {
        return `${key}:${code}`.replace(/[^A-Za-z0-9_:]/g, "_").slice(0, 120);
      }
    }
    for (const child of Object.values(record)) {
      const found = Array.isArray(child) ? child.map(walk).find(Boolean) ?? null : walk(child);
      if (found) return found;
    }
    return null;
  }
  return walk(body);
}

/** Error codes that mean "already recorded": treat as sent. */
const DUPLICATE_CODES = new Set([
  "conversionUploadError:CLICK_CONVERSION_ALREADY_EXISTS",
  "conversionUploadError:DUPLICATE_ORDER_ID",
  "conversionAdjustmentUploadError:CONVERSION_ALREADY_RETRACTED",
]);
/** Error codes worth retrying later rather than giving up on. */
const RETRYABLE_CODES = new Set([
  "conversionUploadError:TOO_RECENT_CONVERSION_ACTION",
  "conversionUploadError:TOO_RECENT_EVENT",
  "conversionAdjustmentUploadError:TOO_RECENT_CONVERSION_ACTION",
  "conversionAdjustmentUploadError:CONVERSION_NOT_FOUND",
  "quotaError:RESOURCE_EXHAUSTED",
  "internalError:INTERNAL_ERROR",
  "internalError:TRANSIENT_ERROR",
]);

export function classifyGoogleAdsFailure(
  httpStatus: number | null,
  body: unknown,
): {outcome: "retryable_failed" | "permanent_failed" | "duplicate"; errorCategory: string} {
  const code = firstGoogleAdsErrorCode(body);
  if (code && DUPLICATE_CODES.has(code)) return {outcome: "duplicate", errorCategory: code};
  if (code && RETRYABLE_CODES.has(code)) return {outcome: "retryable_failed", errorCategory: code};
  if (httpStatus !== null && retryableStatus(httpStatus) && !code) {
    return {outcome: "retryable_failed", errorCategory: `http_${httpStatus}`};
  }
  if (httpStatus !== null && retryableStatus(httpStatus) && code?.startsWith("authenticationError")) {
    return {outcome: "retryable_failed", errorCategory: code};
  }
  if (httpStatus !== null && retryableStatus(httpStatus) && code?.startsWith("authorizationError")) {
    return {outcome: "retryable_failed", errorCategory: code};
  }
  return {outcome: "permanent_failed", errorCategory: code ?? (httpStatus === null ? "network_error" : `http_${httpStatus}`)};
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class GoogleAdsClient {
  private accessToken: {value: string; expiresAt: number} | null = null;

  constructor(
    private readonly credentials: GoogleAdsCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > this.now() + 60_000) return this.accessToken.value;
    const response = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        client_id: this.credentials.oauth.clientId,
        client_secret: this.credentials.oauth.clientSecret,
        refresh_token: this.credentials.oauth.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = tokenResponseSchema.safeParse(await json(response));
    if (!response.ok || !parsed.success) throw new GoogleAdsAuthError(response.status);
    this.accessToken = {
      value: parsed.data.access_token,
      expiresAt: this.now() + (parsed.data.expires_in ?? 3_000) * 1_000,
    };
    return this.accessToken.value;
  }

  private async post(path: string, body: unknown, loginCustomerId: string | null): Promise<GoogleAdsCallResult> {
    let accessToken: string;
    try {
      accessToken = await this.token();
    } catch (error) {
      const status = error instanceof GoogleAdsAuthError ? error.status : null;
      return {outcome: "retryable_failed", httpStatus: status, requestId: null, errorCategory: "oauth_refresh_failed"};
    }
    try {
      const response = await this.fetchImpl(`${ADS_ORIGIN}/${this.credentials.apiVersion}/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          ...(loginCustomerId ? {"login-customer-id": loginCustomerId} : {}),
          ...(this.credentials.developerToken ? {"developer-token": this.credentials.developerToken} : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const requestId = response.headers.get("request-id")?.slice(0, 128) ?? null;
      const responseBody = await json(response);
      const partialFailure = responseBody && typeof responseBody === "object"
        ? (responseBody as {partialFailureError?: unknown}).partialFailureError
        : undefined;
      if (response.ok && !partialFailure) {
        return {outcome: "ok", httpStatus: response.status, requestId, body: responseBody};
      }
      const failure = classifyGoogleAdsFailure(response.status, partialFailure ?? responseBody);
      if (failure.outcome === "duplicate") {
        return {outcome: "duplicate", httpStatus: response.status, requestId, errorCategory: failure.errorCategory};
      }
      return {outcome: failure.outcome, httpStatus: response.status, requestId, errorCategory: failure.errorCategory};
    } catch {
      return {outcome: "retryable_failed", httpStatus: null, requestId: null, errorCategory: "network_error"};
    }
  }

  /** One conversion per call, so each ledger row gets its own outcome. */
  uploadClickConversion(input: {
    customerId: string;
    loginCustomerId: string | null;
    conversion: ClickConversion;
    validateOnly: boolean;
  }) {
    return this.post(
      `customers/${input.customerId}:uploadClickConversions`,
      {conversions: [input.conversion], partialFailure: true, validateOnly: input.validateOnly},
      input.loginCustomerId,
    );
  }

  retractConversion(input: {
    customerId: string;
    loginCustomerId: string | null;
    retraction: ConversionRetraction;
    validateOnly: boolean;
  }) {
    return this.post(
      `customers/${input.customerId}:uploadConversionAdjustments`,
      {conversionAdjustments: [input.retraction], partialFailure: true, validateOnly: input.validateOnly},
      input.loginCustomerId,
    );
  }

  /** GAQL searchStream; returns every result row across batches. */
  async search(input: {customerId: string; loginCustomerId: string | null; query: string}): Promise<
    {ok: true; rows: unknown[]} | {ok: false; errorCategory: string}
  > {
    const result = await this.post(
      `customers/${input.customerId}/googleAds:searchStream`,
      {query: input.query},
      input.loginCustomerId,
    );
    if (result.outcome !== "ok") return {ok: false, errorCategory: "errorCategory" in result ? result.errorCategory : "unknown"};
    const batches = Array.isArray(result.body) ? result.body : [result.body];
    const rows = batches.flatMap((batch) =>
      batch && typeof batch === "object" && Array.isArray((batch as {results?: unknown[]}).results)
        ? (batch as {results: unknown[]}).results
        : [],
    );
    return {ok: true, rows};
  }
}

export class GoogleAdsAuthError extends Error {
  constructor(readonly status: number) {
    super("Google OAuth token refresh failed");
    this.name = "GoogleAdsAuthError";
  }
}

export function conversionActionResource(customerId: string, actionId: string) {
  return `customers/${customerId}/conversionActions/${actionId}`;
}
