import {describe, expect, test, vi} from "vitest";
import {
  ResumeVerificationProviderUnavailableError,
  TwilioVerifyProvider,
} from "./twilio-verify-provider";

const to = "+16095550100";
const providerAttemptId = "VE0123456789abcdef0123456789abcdef";

const documentedVerification = {
  sid: providerAttemptId,
  service_sid: "VA0123456789abcdef0123456789abcdef",
  account_sid: ["AC", "0123456789abcdef0123456789abcdef"].join(""),
  to,
  channel: "sms",
  status: "pending",
  valid: false,
  date_created: "2026-08-26T20:00:00Z",
  date_updated: "2026-08-26T20:00:00Z",
  lookup: {carrier: null},
  send_code_attempts: [{attempt_sid: "VL0123456789abcdef0123456789abcdef"}],
  url: `https://verify.twilio.com/v2/Services/VA0123456789abcdef0123456789abcdef/Verifications/${providerAttemptId}`,
};

function provider(fetchImpl: typeof fetch, timeoutMs = 2_000) {
  return new TwilioVerifyProvider({
    apiKeySid: "SK_test_key",
    apiKeySecret: "test-secret",
    serviceSid: "VA_test_service",
    fetchImpl,
    timeoutMs,
  });
}

describe("TwilioVerifyProvider", () => {
  test("starts an SMS verification with server-side Basic auth and form encoding", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(documentedVerification));

    await expect(provider(fetchImpl).start({to})).resolves.toEqual({
      providerAttemptId,
      status: "pending",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://verify.twilio.com/v2/Services/VA_test_service/Verifications",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from("SK_test_key:test-secret").toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        }),
      }),
    );
    const body = new URLSearchParams(vi.mocked(fetchImpl).mock.calls[0][1]?.body as string);
    expect(Object.fromEntries(body)).toEqual({To: to, Channel: "sms"});
  });

  test("checks a six-digit code against the configured service and destination", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      ...documentedVerification,
      status: "approved",
      valid: true,
    }));

    await expect(provider(fetchImpl).check({to, code: "314159", providerAttemptId}))
      .resolves.toEqual({
      approved: true,
      providerAttemptId,
    });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe(
      "https://verify.twilio.com/v2/Services/VA_test_service/VerificationCheck",
    );
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      VerificationSid: providerAttemptId,
      Code: "314159",
    });
  });

  test("rejects an approved response for a different verification SID", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      ...documentedVerification,
      sid: "VEffffffffffffffffffffffffffffffff",
      status: "approved",
      valid: true,
    }));

    await expect(provider(fetchImpl).check({to, code: "314159", providerAttemptId}))
      .resolves.toEqual({approved: false});
  });

  test.each([
    ["pending", 200],
    ["expired", 404],
    ["max attempts", 429],
  ])("maps %s checks to the same non-approved result", async (_label, status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status === 200
      ? Response.json(documentedVerification)
      : Response.json({code: 20404, message: "provider detail"}, {status}));

    await expect(provider(fetchImpl).check({to, code: "314159", providerAttemptId})).resolves.toEqual({
      approved: false,
    });
  });

  test("maps timeout and network failures to one stable privacy-safe error", async () => {
    const timeoutFetch = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const networkFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("getaddrinfo ENOTFOUND verify.twilio.com");
    });

    await expect(provider(timeoutFetch, 1).start({to})).rejects.toEqual(
      new ResumeVerificationProviderUnavailableError(),
    );
    await expect(provider(networkFetch).check({to, code: "314159", providerAttemptId})).rejects.toEqual(
      new ResumeVerificationProviderUnavailableError(),
    );
  });

  test("rejects malformed provider success bodies without leaking them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      sid: "not-a-verification-sid",
      status: "pending",
      destination: to,
    }));

    await expect(provider(fetchImpl).start({to})).rejects.toEqual(
      new ResumeVerificationProviderUnavailableError(),
    );
  });
});
