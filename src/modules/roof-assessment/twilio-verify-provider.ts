import "server-only";
import {timingSafeEqual} from "node:crypto";
import {z} from "zod";
import type {ResumeVerificationProvider} from "./resume-verification";

const phoneSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const providerAttemptIdSchema = z.string().regex(/^VE[0-9a-fA-F]{32}$/);
const startResponseSchema = z.object({
  sid: providerAttemptIdSchema,
  status: z.literal("pending"),
}).passthrough();
const checkResponseSchema = z.object({
  sid: providerAttemptIdSchema,
  status: z.string(),
}).passthrough();

function sameProviderAttempt(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected, "ascii");
  const actualBytes = Buffer.from(actual, "ascii");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export class ResumeVerificationProviderUnavailableError extends Error {
  constructor() {
    super("Verification is temporarily unavailable");
    this.name = "ResumeVerificationProviderUnavailableError";
  }
}

type TwilioVerifyProviderOptions = {
  apiKeySid: string;
  apiKeySecret: string;
  serviceSid: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class TwilioVerifyProvider implements ResumeVerificationProvider {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: TwilioVerifyProviderOptions) {
    if (
      !/^SK[A-Za-z0-9_]{2,64}$/.test(options.apiKeySid)
      || !/^VA[A-Za-z0-9_]{2,64}$/.test(options.serviceSid)
      || options.apiKeySecret.length < 1
    ) {
      throw new ResumeVerificationProviderUnavailableError();
    }
    this.baseUrl = `https://verify.twilio.com/v2/Services/${options.serviceSid}`;
    this.authorization = `Basic ${Buffer.from(
      `${options.apiKeySid}:${options.apiKeySecret}`,
      "utf8",
    ).toString("base64")}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  private async post(path: string, body: URLSearchParams) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: this.authorization,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      throw new ResumeVerificationProviderUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }

  async start(input: {to: string}) {
    const parsedTo = phoneSchema.safeParse(input.to);
    if (!parsedTo.success) throw new ResumeVerificationProviderUnavailableError();
    const response = await this.post("/Verifications", new URLSearchParams({
      To: parsedTo.data,
      Channel: "sms",
    }));
    if (!response.ok) throw new ResumeVerificationProviderUnavailableError();
    try {
      const result = startResponseSchema.parse(await response.json());
      return {providerAttemptId: result.sid, status: result.status};
    } catch {
      throw new ResumeVerificationProviderUnavailableError();
    }
  }

  async check(input: {to: string; code: string; providerAttemptId: string}) {
    const parsed = z.strictObject({
      to: phoneSchema,
      code: z.string().regex(/^[0-9]{6}$/),
      providerAttemptId: providerAttemptIdSchema,
    }).safeParse(input);
    if (!parsed.success) return {approved: false} as const;
    const response = await this.post("/VerificationCheck", new URLSearchParams({
      VerificationSid: parsed.data.providerAttemptId,
      Code: parsed.data.code,
    }));
    if ([404, 409, 410, 429].includes(response.status)) return {approved: false} as const;
    if (!response.ok) throw new ResumeVerificationProviderUnavailableError();
    try {
      const result = checkResponseSchema.parse(await response.json());
      if (
        result.status !== "approved"
        || !sameProviderAttempt(parsed.data.providerAttemptId, result.sid)
      ) return {approved: false} as const;
      return {approved: true, providerAttemptId: result.sid} as const;
    } catch {
      throw new ResumeVerificationProviderUnavailableError();
    }
  }
}
