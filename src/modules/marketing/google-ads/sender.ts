import "server-only";
import { googleAdsDateTime, type GoogleAdsClient } from "./client";
import { conversionActionResource } from "./client";
import {
  conversionPayloadHash,
  decideConversion,
  outcomeFromCall,
  type ClaimedConversion,
  type ConversionOutcome,
} from "./conversions";
import type { DueRetraction } from "./repository";

export interface ConversionDeliveryRepository {
  claim(deliveryId: string): Promise<ClaimedConversion | null>;
  complete(deliveryId: string, outcome: ConversionOutcome): Promise<void>;
}

type UploadClient = Pick<GoogleAdsClient, "uploadClickConversion">;

/**
 * Sends one queued conversion. Never throws for a Google-side failure: the
 * outcome is written to the ledger, which owns retries and backoff.
 * `client` is null when no API credentials are configured; then dry-run rows
 * are validated locally and live rows wait.
 */
export async function sendGoogleAdsConversion(
  deliveryId: string,
  dependencies: {repository: ConversionDeliveryRepository; client: UploadClient | null},
): Promise<{deliveryId: string; outcome: ConversionOutcome["outcome"] | "noop"}> {
  const row = await dependencies.repository.claim(deliveryId);
  if (!row) return {deliveryId, outcome: "noop"};

  const decision = decideConversion(row);
  let outcome: ConversionOutcome;
  if (decision.kind === "skip") {
    outcome = {outcome: "skipped", skipReason: decision.reason};
  } else if (decision.kind === "defer") {
    outcome = {outcome: "deferred", errorCategory: decision.reason, skipReason: decision.reason};
  } else {
    const payloadHash = conversionPayloadHash(decision.conversion);
    if (!dependencies.client) {
      outcome = row.dry_run
        ? {outcome: "validated", httpStatus: null, requestId: null, payloadHash}
        : {outcome: "deferred", errorCategory: "google_ads_not_configured", skipReason: "google_ads_not_configured"};
    } else {
      const call = await dependencies.client.uploadClickConversion({
        customerId: row.customer_id,
        loginCustomerId: row.login_customer_id,
        conversion: decision.conversion,
        validateOnly: row.dry_run,
      });
      outcome = outcomeFromCall(call, payloadHash, row.dry_run, decision);
    }
  }

  await dependencies.repository.complete(row.id, outcome);
  return {deliveryId: row.id, outcome: outcome.outcome};
}

export interface RetractionRepository {
  listDueRetractions(limit: number): Promise<DueRetraction[]>;
  completeRetraction(deliveryId: string, succeeded: boolean, errorCategory: string | null): Promise<void>;
}

/** Retracts conversions for leads flagged as junk within 14 days of upload. */
export async function sendGoogleAdsRetractions(
  dependencies: {
    repository: RetractionRepository;
    client: Pick<GoogleAdsClient, "retractConversion"> | null;
    now: () => Date;
  },
  limit = 25,
) {
  if (!dependencies.client) return {retracted: 0, failed: 0};
  const due = await dependencies.repository.listDueRetractions(limit);
  let retracted = 0;
  let failed = 0;
  for (const row of due) {
    // A retraction only exists for a real upload; dry run never retracts.
    if (row.dry_run || !row.conversion_action_id) continue;
    const call = await dependencies.client.retractConversion({
      customerId: row.customer_id,
      loginCustomerId: row.login_customer_id,
      retraction: {
        conversionAction: conversionActionResource(row.customer_id, row.conversion_action_id),
        adjustmentType: "RETRACTION",
        orderId: row.order_id,
        adjustmentDateTime: googleAdsDateTime(dependencies.now().toISOString()),
      },
      validateOnly: false,
    });
    const ok = call.outcome === "ok" || call.outcome === "duplicate";
    await dependencies.repository.completeRetraction(row.id, ok, ok ? null : "errorCategory" in call ? call.errorCategory : null);
    if (ok) retracted += 1;
    else failed += 1;
  }
  return {retracted, failed};
}
