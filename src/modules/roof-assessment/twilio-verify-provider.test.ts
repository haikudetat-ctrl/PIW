import {describe, expect, test, vi} from "vitest";
import {
  ResumeVerificationProviderUnavailableError,
  TwilioVerifyProvider,
} from "./twilio-verify-provider";

const to = "+16095550100";

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
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      sid: "VEtestattempt",
      status: "pending",
    }));

    await expect(provider(fetchImpl).start({to})).resolves.toEqual({
      providerAttemptId: "VEtestattempt",
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
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({status: "approved"}));

    await expect(provider(fetchImpl).check({to, code: "314159"})).resolves.toEqual({
      approved: true,
    });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe(
      "https://verify.twilio.com/v2/Services/VA_test_service/VerificationCheck",
    );
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      To: to,
      Code: "314159",
    });
  });

  test.each([
    ["pending", 200],
    ["expired", 404],
    ["max attempts", 429],
  ])("maps %s checks to the same non-approved result", async (_label, status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status === 200
      ? Response.json({status: "pending"})
      : Response.json({code: 20404, message: "provider detail"}, {status}));

    await expect(provider(fetchImpl).check({to, code: "314159"})).resolves.toEqual({
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
    await expect(provider(networkFetch).check({to, code: "314159"})).rejects.toEqual(
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
