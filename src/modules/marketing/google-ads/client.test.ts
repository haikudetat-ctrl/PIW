import { describe, expect, test, vi } from "vitest";
import {
  classifyGoogleAdsFailure,
  firstGoogleAdsErrorCode,
  GoogleAdsClient,
  googleAdsDateTime,
  normalizeGoogleEmail,
  normalizeGooglePhone,
} from "./client";

const credentials = {apiVersion: "v26", oauth: {clientId: "id", clientSecret: "secret", refreshToken: "refresh"}, developerToken: null};

function partialFailure(code: Record<string, string>) {
  return {partialFailureError: {code: 3, details: [{errors: [{errorCode: code, message: "x"}]}]}};
}

describe("normalization", () => {
  test("emails follow Google's rules", () => {
    expect(normalizeGoogleEmail(" A.B@GoogleMail.com ")).toBe("ab@googlemail.com");
    expect(normalizeGoogleEmail("a.b@example.com")).toBe("a.b@example.com");
    expect(normalizeGoogleEmail("not-an-email")).toBeNull();
  });
  test("phones must already be E.164", () => {
    expect(normalizeGooglePhone("+16095550101")).toBe("+16095550101");
    expect(normalizeGooglePhone("6095550101")).toBeNull();
  });
  test("conversion times use Google's format", () => {
    expect(googleAdsDateTime("2026-10-20T10:00:00-04:00")).toBe("2026-10-20 14:00:00+00:00");
  });
});

describe("failure classification", () => {
  test("reads the first error code", () => {
    expect(firstGoogleAdsErrorCode(partialFailure({conversionUploadError: "CLICK_NOT_FOUND"}))).toBe("conversionUploadError:CLICK_NOT_FOUND");
  });
  test.each([
    [400, partialFailure({conversionUploadError: "CLICK_NOT_FOUND"}), "permanent_failed"],
    [200, partialFailure({conversionUploadError: "CLICK_CONVERSION_ALREADY_EXISTS"}), "duplicate"],
    [200, partialFailure({conversionUploadError: "TOO_RECENT_CONVERSION_ACTION"}), "retryable_failed"],
    [503, null, "retryable_failed"],
    [429, null, "retryable_failed"],
    [401, {error: {details: [{errors: [{errorCode: {authenticationError: "OAUTH_TOKEN_EXPIRED"}}]}]}}, "retryable_failed"],
    [400, {error: {details: [{errors: [{errorCode: {requestError: "INVALID_INPUT"}}]}]}}, "permanent_failed"],
  ])("%s %o -> %s", (status, body, outcome) => {
    expect(classifyGoogleAdsFailure(status, body).outcome).toBe(outcome);
  });
});

describe("GoogleAdsClient", () => {
  test("refreshes a token once and posts one conversion with partial failure on", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).startsWith("https://oauth2.googleapis.com")) {
        return new Response(JSON.stringify({access_token: "AT", expires_in: 3600}), {status: 200});
      }
      return new Response(JSON.stringify({results: [{}]}), {status: 200, headers: {"request-id": "req-1"}});
    });
    const client = new GoogleAdsClient(credentials, fetchImpl as unknown as typeof fetch);
    const conversion = {gclid: "G", conversionAction: "customers/1/conversionActions/2", conversionDateTime: "2026-10-20 14:00:00+00:00", orderId: "ql-x", consent: {adUserData: "GRANTED" as const}};
    const first = await client.uploadClickConversion({customerId: "1234567890", loginCustomerId: "9999999999", conversion, validateOnly: true});
    await client.uploadClickConversion({customerId: "1234567890", loginCustomerId: null, conversion, validateOnly: false});
    expect(first).toMatchObject({outcome: "ok", requestId: "req-1"});
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("oauth2")).length).toBe(1);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://googleads.googleapis.com/v26/customers/1234567890:uploadClickConversions");
    expect((init.headers as Record<string, string>)["login-customer-id"]).toBe("9999999999");
    expect((init.headers as Record<string, string>)["developer-token"]).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({conversions: [conversion], partialFailure: true, validateOnly: true});
  });

  test("treats a partial failure on a 200 as a failure", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => String(url).includes("oauth2")
      ? new Response(JSON.stringify({access_token: "AT"}), {status: 200})
      : new Response(JSON.stringify(partialFailure({conversionUploadError: "CLICK_NOT_FOUND"})), {status: 200}));
    const client = new GoogleAdsClient(credentials, fetchImpl as unknown as typeof fetch);
    const result = await client.uploadClickConversion({
      customerId: "1234567890", loginCustomerId: null, validateOnly: false,
      conversion: {gclid: "G", conversionAction: "c", conversionDateTime: "d", orderId: "o", consent: {adUserData: "GRANTED"}},
    });
    expect(result).toMatchObject({outcome: "permanent_failed", errorCategory: "conversionUploadError:CLICK_NOT_FOUND"});
  });

  test("a failed token refresh is retryable", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", {status: 400}));
    const client = new GoogleAdsClient(credentials, fetchImpl as unknown as typeof fetch);
    const result = await client.search({customerId: "1234567890", loginCustomerId: null, query: "SELECT"});
    expect(result).toEqual({ok: false, errorCategory: "oauth_refresh_failed"});
  });

  test("flattens searchStream batches", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => String(url).includes("oauth2")
      ? new Response(JSON.stringify({access_token: "AT"}), {status: 200})
      : new Response(JSON.stringify([{results: [{a: 1}]}, {results: [{a: 2}]}]), {status: 200}));
    const client = new GoogleAdsClient(credentials, fetchImpl as unknown as typeof fetch);
    expect(await client.search({customerId: "1234567890", loginCustomerId: null, query: "SELECT"})).toEqual({ok: true, rows: [{a: 1}, {a: 2}]});
  });
});
