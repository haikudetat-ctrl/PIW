import { describe, expect, test } from "vitest";
import { sha256Hex } from "./client";
import { decideConversion, outcomeFromCall, type ClaimedConversion } from "./conversions";

function row(overrides: Partial<ClaimedConversion> = {}): ClaimedConversion {
  return {
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
    login_customer_id: "9876543210",
    conversion_action_id: "111",
    dry_run: false,
    send_conversion_values: false,
    identifier_only_uploads: false,
    consent_model: "opt_in",
    currency_code: "USD",
    consent_state: "granted",
    click_id_type: "gclid",
    click_id: "G1",
    email: " Jane.Doe@Gmail.com ",
    phone_e164: "+16095550101",
    ...overrides,
  };
}

describe("decideConversion", () => {
  test("builds an enhanced click conversion with hashed, normalized identifiers", () => {
    const decision = decideConversion(row());
    expect(decision.kind).toBe("send");
    if (decision.kind !== "send") return;
    expect(decision.conversion).toEqual({
      gclid: "G1",
      conversionAction: "customers/1234567890/conversionActions/111",
      conversionDateTime: "2026-10-20 14:00:00+00:00",
      orderId: "ql-00000000000040008000000000000001",
      userIdentifiers: [
        {hashedEmail: sha256Hex("janedoe@gmail.com")},
        {hashedPhoneNumber: sha256Hex("+16095550101")},
      ],
      consent: {adUserData: "GRANTED"},
    });
  });

  test("sends a value only when the owner allows it", () => {
    const held = decideConversion(row({event_name: "sold", conversion_value: "14250.00"}));
    expect(held.kind).toBe("send");
    expect(held.kind === "send" && "conversionValue" in held.conversion).toBe(false);
    const sent = decideConversion(row({event_name: "sold", conversion_value: "14250.00", send_conversion_values: true}));
    expect(sent.kind === "send" && sent.conversion).toMatchObject({conversionValue: 14250, currencyCode: "USD"});
  });

  test.each([
    [{consent_state: "denied" as const}, "skip", "advertising_consent_denied"],
    [{consent_state: "unknown" as const}, "defer", "awaiting_consent"],
    [{conversion_action_id: null}, "defer", "conversion_action_missing"],
    [{click_id: null, click_id_type: null}, "skip", "no_click_id"],
    [{click_id: null, click_id_type: null, identifier_only_uploads: true, consent_state: "unknown" as const}, "defer", "awaiting_consent"],
  ])("%o -> %s %s", (overrides, kind, reason) => {
    const decision = decideConversion(row(overrides));
    expect(decision.kind).toBe(kind);
    expect("reason" in decision ? decision.reason : null).toBe(reason);
  });

  test("uploads with the click ID under opt-out when no decision was recorded", () => {
    const decision = decideConversion(row({consent_state: "unknown", consent_model: "opt_out"}));
    expect(decision.kind).toBe("send");
  });

  test("uploads identifiers alone only with explicit consent", () => {
    const decision = decideConversion(row({click_id: null, click_id_type: null, identifier_only_uploads: true}));
    expect(decision.kind === "send" && "gclid" in decision.conversion).toBe(false);
    expect(decision.kind === "send" && decision.withIdentifiers).toBe(true);
  });

  test("sends gbraid instead of gclid when that is the click ID", () => {
    const decision = decideConversion(row({click_id_type: "gbraid", click_id: "B1"}));
    expect(decision.kind === "send" && decision.conversion).toMatchObject({gbraid: "B1"});
    expect(decision.kind === "send" && "gclid" in decision.conversion).toBe(false);
  });
});

describe("outcomeFromCall", () => {
  const decision = decideConversion(row());
  if (decision.kind !== "send") throw new Error("fixture");

  test("a dry run that passes validation is not recorded as sent", () => {
    expect(outcomeFromCall({outcome: "ok", httpStatus: 200, requestId: "r", body: {}}, "h".repeat(64), true, decision).outcome).toBe("validated");
  });
  test("a duplicate is a success", () => {
    expect(outcomeFromCall({outcome: "duplicate", httpStatus: 200, requestId: "r", errorCategory: "x"}, "h".repeat(64), false, decision).outcome).toBe("sent");
  });
});
