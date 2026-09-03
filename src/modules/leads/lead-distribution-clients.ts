import "server-only";
import {z} from "zod";
import {
  buildInternalLeadEmail,
  classifyLeadConduitResponse,
  toLeadConduitForm,
  type LeadConduitResult,
  type MetaDistributionLead,
  type MetaLeadSource,
} from "./meta-lead-distribution";

const LEADCONDUIT_SUBMISSION_URL =
  "https://app.leadconduit.com/flows/6377949a81800d03d54119b5/sources/6a999da372afc3570dc712a1/submit";
const RESEND_EMAIL_URL = "https://api.resend.com/emails";
const INTERNAL_RECIPIENT = "roofingleads@allseason.solar";
const REQUEST_TIMEOUT_MS = 10_000;

type Fetcher = typeof fetch;

async function jsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class LeadConduitSubmissionClient {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async send(lead: MetaDistributionLead, source: MetaLeadSource): Promise<LeadConduitResult> {
    try {
      const response = await this.fetcher(LEADCONDUIT_SUBMISSION_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "PIW-Lead-Distribution/1.0",
        },
        body: toLeadConduitForm(lead, source),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return classifyLeadConduitResponse(response.status, await jsonBody(response));
    } catch {
      return {status: "retryable_failed", externalId: null, reason: "transport_error"};
    }
  }
}

const resendSuccessSchema = z.object({id: z.string().min(1)}).passthrough();

export class ResendLeadNotificationClient {
  private readonly fetcher: Fetcher;

  constructor(private readonly configuration: {
    apiKey: string;
    fromEmail: string;
    appBaseUrl: string;
    fetcher?: Fetcher;
  }) {
    this.fetcher = configuration.fetcher ?? fetch;
  }

  async send(lead: MetaDistributionLead, source: MetaLeadSource): Promise<LeadConduitResult> {
    const email = buildInternalLeadEmail(
      lead,
      source,
      `${this.configuration.appBaseUrl}/leads/${lead.id}`,
    );
    try {
      const response = await this.fetcher(RESEND_EMAIL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.configuration.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `lead-notification/${lead.id}`,
          "User-Agent": "PIW-Lead-Distribution/1.0",
        },
        body: JSON.stringify({
          from: `All Season Roofing <${this.configuration.fromEmail}>`,
          to: [INTERNAL_RECIPIENT],
          subject: email.subject,
          text: email.text,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await jsonBody(response);
      const success = resendSuccessSchema.safeParse(body);
      if (response.ok && success.success) {
        return {status: "sent", externalId: success.data.id, reason: null};
      }
      if (response.status === 429 || response.status >= 500) {
        return {status: "retryable_failed", externalId: null, reason: `HTTP ${response.status}`};
      }
      return {status: "permanent_failed", externalId: null, reason: `HTTP ${response.status}`};
    } catch {
      return {status: "retryable_failed", externalId: null, reason: "transport_error"};
    }
  }
}
