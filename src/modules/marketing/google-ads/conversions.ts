import "server-only";
import { z } from "zod";
import {
  conversionActionResource,
  googleAdsDateTime,
  normalizeGoogleEmail,
  normalizeGooglePhone,
  sha256Hex,
  type ClickConversion,
  type GoogleAdsCallResult,
} from "./client";

/** What claim_ad_conversion returns. Contact details are hashed in memory and dropped. */
export const claimedConversionSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  lead_id: z.uuid(),
  event_name: z.enum(["qualified_lead", "appointment_set", "appointment_ran", "sold"]),
  order_id: z.string().min(1),
  conversion_time: z.string().min(1),
  conversion_value: z.union([z.number(), z.string()]).nullable(),
  attempt_count: z.number().int(),
  created_at: z.string(),
  customer_id: z.string().regex(/^\d{10}$/),
  login_customer_id: z.string().regex(/^\d{10}$/).nullable(),
  conversion_action_id: z.string().regex(/^\d+$/).nullable(),
  dry_run: z.boolean(),
  send_conversion_values: z.boolean(),
  identifier_only_uploads: z.boolean(),
  consent_model: z.enum(["opt_in", "opt_out"]),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  consent_state: z.enum(["granted", "denied", "unknown"]),
  click_id_type: z.enum(["gclid", "gbraid", "wbraid"]).nullable(),
  click_id: z.string().nullable(),
  email: z.string().nullable(),
  phone_e164: z.string().nullable(),
});

export type ClaimedConversion = z.infer<typeof claimedConversionSchema>;

export type ConversionOutcome =
  | {outcome: "sent"; httpStatus: number | null; requestId: string | null; payloadHash: string; withValue: boolean; withIdentifiers: boolean}
  | {outcome: "validated"; httpStatus: number | null; requestId: string | null; payloadHash: string}
  | {outcome: "deferred"; errorCategory: string; skipReason: string}
  | {outcome: "skipped"; skipReason: string}
  | {outcome: "retryable_failed" | "permanent_failed"; httpStatus: number | null; requestId: string | null; errorCategory: string; payloadHash: string | null};

export type ConversionDecision =
  | {kind: "send"; conversion: ClickConversion; withValue: boolean; withIdentifiers: boolean}
  | {kind: "defer"; reason: string}
  | {kind: "skip"; reason: string};

/**
 * Whether and what to upload. Consent rules:
 *   granted   -> upload with hashed email/phone (enhanced conversions)
 *   denied    -> never upload
 *   unknown   -> opt_out: upload with the click ID; opt_in: wait for a decision
 * Uploads without a click ID need explicit consent under either model.
 */
export function decideConversion(row: ClaimedConversion): ConversionDecision {
  if (!row.conversion_action_id) return {kind: "defer", reason: "conversion_action_missing"};
  if (row.consent_state === "denied") return {kind: "skip", reason: "advertising_consent_denied"};

  const hasClick = Boolean(row.click_id && row.click_id_type);
  if (!hasClick && !row.identifier_only_uploads) return {kind: "skip", reason: "no_click_id"};
  if (!hasClick && row.consent_state !== "granted") return {kind: "defer", reason: "awaiting_consent"};
  if (row.consent_state === "unknown" && row.consent_model === "opt_in") {
    return {kind: "defer", reason: "awaiting_consent"};
  }

  const email = row.email ? normalizeGoogleEmail(row.email) : null;
  const phone = normalizeGooglePhone(row.phone_e164);
  const userIdentifiers = [
    ...(email ? [{hashedEmail: sha256Hex(email)}] : []),
    ...(phone ? [{hashedPhoneNumber: sha256Hex(phone)}] : []),
  ];
  if (!hasClick && userIdentifiers.length === 0) return {kind: "skip", reason: "no_identifier"};

  const value = row.conversion_value === null ? null : Number(row.conversion_value);
  const withValue = row.send_conversion_values && value !== null && Number.isFinite(value) && value > 0;

  const conversion: ClickConversion = {
    ...(hasClick ? {[row.click_id_type!]: row.click_id!} : {}),
    conversionAction: conversionActionResource(row.customer_id, row.conversion_action_id),
    conversionDateTime: googleAdsDateTime(row.conversion_time),
    ...(withValue ? {conversionValue: value!, currencyCode: row.currency_code} : {}),
    orderId: row.order_id,
    ...(userIdentifiers.length ? {userIdentifiers} : {}),
    consent: {adUserData: "GRANTED"},
  };
  return {kind: "send", conversion, withValue, withIdentifiers: userIdentifiers.length > 0};
}

export function conversionPayloadHash(conversion: ClickConversion) {
  return sha256Hex(JSON.stringify(conversion));
}

export function outcomeFromCall(
  call: GoogleAdsCallResult,
  payloadHash: string,
  dryRun: boolean,
  decision: Extract<ConversionDecision, {kind: "send"}>,
): ConversionOutcome {
  if (call.outcome === "ok" || call.outcome === "duplicate") {
    return dryRun
      ? {outcome: "validated", httpStatus: call.httpStatus, requestId: call.requestId, payloadHash}
      : {
        outcome: "sent",
        httpStatus: call.httpStatus,
        requestId: call.requestId,
        payloadHash,
        withValue: decision.withValue,
        withIdentifiers: decision.withIdentifiers,
      };
  }
  return {
    outcome: call.outcome,
    httpStatus: call.httpStatus,
    requestId: call.requestId,
    errorCategory: call.errorCategory,
    payloadHash,
  };
}
