import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { claimedConversionSchema, type ClaimedConversion, type ConversionOutcome } from "./conversions";

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}>;
};

export class GoogleAdsRepositoryError extends Error {
  constructor(operation: string) {
    super(`Google Ads persistence failed during ${operation}`);
    this.name = "GoogleAdsRepositoryError";
  }
}

const idRowsSchema = z.array(z.object({id: z.uuid()})).max(100);
const retractionRowsSchema = z.array(z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  order_id: z.string(),
  event_name: z.string(),
  customer_id: z.string().regex(/^\d{10}$/),
  login_customer_id: z.string().regex(/^\d{10}$/).nullable(),
  conversion_action_id: z.string().regex(/^\d+$/).nullable(),
  dry_run: z.boolean(),
})).max(100);

export type DueRetraction = z.infer<typeof retractionRowsSchema>[number];

export class SupabaseGoogleAdsRepository {
  constructor(
    private readonly client: RpcClient = createServiceClient() as unknown as RpcClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(companyId: string): Promise<Record<string, unknown>> {
    const {data, error} = await this.client.rpc("enqueue_google_ads_conversions", {
      p_company_id: companyId,
      p_now: this.now().toISOString(),
    });
    if (error) throw new GoogleAdsRepositoryError("enqueue");
    return (data ?? {}) as Record<string, unknown>;
  }

  async listDue(limit: number): Promise<string[]> {
    const {data, error} = await this.client.rpc("list_due_ad_conversions", {
      p_limit: limit,
      p_now: this.now().toISOString(),
    });
    if (error) throw new GoogleAdsRepositoryError("listDue");
    const parsed = idRowsSchema.safeParse(data ?? []);
    if (!parsed.success) throw new GoogleAdsRepositoryError("listDue");
    return parsed.data.map((row) => row.id);
  }

  async claim(deliveryId: string): Promise<ClaimedConversion | null> {
    const {data, error} = await this.client.rpc("claim_ad_conversion", {
      p_delivery_id: deliveryId,
      p_now: this.now().toISOString(),
    });
    if (error) throw new GoogleAdsRepositoryError("claim");
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return null;
    const parsed = claimedConversionSchema.safeParse(rows[0]);
    if (!parsed.success) throw new GoogleAdsRepositoryError("claim");
    return parsed.data;
  }

  async complete(deliveryId: string, outcome: ConversionOutcome): Promise<void> {
    const base = {p_delivery_id: deliveryId, p_now: this.now().toISOString()};
    const args = (() => {
      switch (outcome.outcome) {
        case "sent":
          return {...base, p_outcome: "sent", p_http_status: outcome.httpStatus, p_payload_hash: outcome.payloadHash,
            p_request_id: outcome.requestId, p_sent_with_value: outcome.withValue, p_sent_with_identifiers: outcome.withIdentifiers};
        case "validated":
          return {...base, p_outcome: "validated", p_http_status: outcome.httpStatus, p_payload_hash: outcome.payloadHash,
            p_request_id: outcome.requestId};
        case "deferred":
          return {...base, p_outcome: "deferred", p_error_category: outcome.errorCategory, p_skip_reason: outcome.skipReason};
        case "skipped":
          return {...base, p_outcome: "skipped", p_skip_reason: outcome.skipReason};
        default:
          return {...base, p_outcome: outcome.outcome, p_http_status: outcome.httpStatus,
            p_error_category: outcome.errorCategory, p_payload_hash: outcome.payloadHash, p_request_id: outcome.requestId};
      }
    })();
    const {error} = await this.client.rpc("complete_ad_conversion", args);
    if (error) throw new GoogleAdsRepositoryError("complete");
  }

  async listDueRetractions(limit: number): Promise<DueRetraction[]> {
    const {data, error} = await this.client.rpc("list_due_ad_conversion_retractions", {
      p_limit: limit,
      p_now: this.now().toISOString(),
    });
    if (error) throw new GoogleAdsRepositoryError("listDueRetractions");
    const parsed = retractionRowsSchema.safeParse(data ?? []);
    if (!parsed.success) throw new GoogleAdsRepositoryError("listDueRetractions");
    return parsed.data;
  }

  async completeRetraction(deliveryId: string, succeeded: boolean, errorCategory: string | null) {
    const {error} = await this.client.rpc("complete_ad_conversion_retraction", {
      p_delivery_id: deliveryId,
      p_succeeded: succeeded,
      p_now: this.now().toISOString(),
      p_error_category: errorCategory,
    });
    if (error) throw new GoogleAdsRepositoryError("completeRetraction");
  }

  async health(companyId: string): Promise<Record<string, unknown>> {
    const {data, error} = await this.client.rpc("paid_search_health", {
      p_company_id: companyId,
      p_now: this.now().toISOString(),
    });
    if (error) throw new GoogleAdsRepositoryError("health");
    return (data ?? {}) as Record<string, unknown>;
  }

  async purgeExpiredClickIds(): Promise<Record<string, unknown>> {
    const {data, error} = await this.client.rpc("purge_expired_click_ids", {p_now: this.now().toISOString()});
    if (error) throw new GoogleAdsRepositoryError("purgeExpiredClickIds");
    return (data ?? {}) as Record<string, unknown>;
  }
}
