import "server-only";
import {z} from "zod";
import type {ResumeVerificationProvider} from "./resume-verification";

const phoneSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const startResponseSchema = z.strictObject({
  sid: z.string().regex(/^VE[A-Za-z0-9]{2,64}$/),
  status: z.literal("pending"),
});
const checkResponseSchema = z.object({status: z.string()}).passthrough();

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

  async check(input: {to: string; code: string}) {
    const parsed = z.strictObject({
      to: phoneSchema,
      code: z.string().regex(/^[0-9]{6}$/),
    }).safeParse(input);
    if (!parsed.success) return {approved: false};
    const response = await this.post("/VerificationCheck", new URLSearchParams({
      To: parsed.data.to,
      Code: parsed.data.code,
    }));
    if ([404, 409, 410, 429].includes(response.status)) return {approved: false};
    if (!response.ok) throw new ResumeVerificationProviderUnavailableError();
    try {
      return {approved: checkResponseSchema.parse(await response.json()).status === "approved"};
    } catch {
      throw new ResumeVerificationProviderUnavailableError();
    }
  }
}
