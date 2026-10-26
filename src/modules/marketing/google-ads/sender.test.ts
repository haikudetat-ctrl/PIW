import { describe, expect, test, vi } from "vitest";
import type { ClaimedConversion } from "./conversions";
import { sendGoogleAdsConversion, sendGoogleAdsRetractions } from "./sender";

const claimed: ClaimedConversion = {
  id: "d0000000-0000-4000-8000-000000000001",
  company_id: "c0000000-0000-4000-8000-000000000001",
  lead_id: "l0000000-0000-4000-8000-000000000001",
  event_name: "qualified_lead",
  order_id: "ql-00000000000040008000000000000001",
  conversion_time: "2026-10-20T14:00:00+00:00",
  conversion_value: null,
  attempt_count: 1,
  created_at: "2026-10-21T14:00:00+00:00",
  customer_id: "1234567890",
  login_customer_id: null,
  conversion_action_id: "111",
  dry_run: false,
  send_conversion_values: false,
  identifier_only_uploads: false,
  consent_model: "opt_in",
  currency_code: "USD",
  consent_state: "granted",
  click_id_type: "gclid",
  click_id: "G1",
  email: "a@example.com",
  phone_e164: "+16095550101",
};

function repository(row: ClaimedConversion | null) {
  return {claim: vi.fn(async () => row), complete: vi.fn(async () => undefined)};
}

describe("sendGoogleAdsConversion", () => {
  test("uploads and records the outcome", async () => {
    const repo = repository(claimed);
    const client = {uploadClickConversion: vi.fn(async () => ({outcome: "ok" as const, httpStatus: 200, requestId: "r", body: {}}))};
    expect(await sendGoogleAdsConversion(claimed.id, {repository: repo, client})).toEqual({deliveryId: claimed.id, outcome: "sent"});
    expect(client.uploadClickConversion).toHaveBeenCalledWith(expect.objectContaining({validateOnly: false}));
    expect(repo.complete).toHaveBeenCalledWith(claimed.id, expect.objectContaining({outcome: "sent", withIdentifiers: true, withValue: false}));
  });

  test("dry run validates against Google without recording a conversion", async () => {
    const repo = repository({...claimed, dry_run: true});
    const client = {uploadClickConversion: vi.fn(async () => ({outcome: "ok" as const, httpStatus: 200, requestId: "r", body: {}}))};
    await sendGoogleAdsConversion(claimed.id, {repository: repo, client});
    expect(client.uploadClickConversion).toHaveBeenCalledWith(expect.objectContaining({validateOnly: true}));
    expect(repo.complete).toHaveBeenCalledWith(claimed.id, expect.objectContaining({outcome: "validated"}));
  });

  test("never calls Google for a denied lead", async () => {
    const repo = repository({...claimed, consent_state: "denied"});
    const client = {uploadClickConversion: vi.fn()};
    await sendGoogleAdsConversion(claimed.id, {repository: repo, client});
    expect(client.uploadClickConversion).not.toHaveBeenCalled();
    expect(repo.complete).toHaveBeenCalledWith(claimed.id, {outcome: "skipped", skipReason: "advertising_consent_denied"});
  });

  test("waits when live uploads have no credentials yet", async () => {
    const repo = repository(claimed);
    await sendGoogleAdsConversion(claimed.id, {repository: repo, client: null});
    expect(repo.complete).toHaveBeenCalledWith(claimed.id, expect.objectContaining({outcome: "deferred", errorCategory: "google_ads_not_configured"}));
  });

  test("is a no-op when another worker holds the delivery", async () => {
    expect(await sendGoogleAdsConversion(claimed.id, {repository: repository(null), client: null})).toEqual({deliveryId: claimed.id, outcome: "noop"});
  });
});

describe("sendGoogleAdsRetractions", () => {
  test("retracts by order ID and records success", async () => {
    const repo = {
      listDueRetractions: vi.fn(async () => [{
        id: claimed.id, company_id: claimed.company_id, order_id: claimed.order_id, event_name: "qualified_lead",
        customer_id: "1234567890", login_customer_id: null, conversion_action_id: "111", dry_run: false,
      }]),
      completeRetraction: vi.fn(async () => undefined),
    };
    const client = {retractConversion: vi.fn(async () => ({outcome: "ok" as const, httpStatus: 200, requestId: "r", body: {}}))};
    expect(await sendGoogleAdsRetractions({repository: repo, client, now: () => new Date("2026-10-24T00:00:00Z")})).toEqual({retracted: 1, failed: 0});
    expect(client.retractConversion).toHaveBeenCalledWith(expect.objectContaining({
      retraction: expect.objectContaining({adjustmentType: "RETRACTION", orderId: claimed.order_id}),
    }));
    expect(repo.completeRetraction).toHaveBeenCalledWith(claimed.id, true, null);
  });
});
