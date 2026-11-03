import { describe, expect, it } from "vitest";
import { estimateWebhookConfigured, onlyWhen, scheduleGates } from "./schedule-gates";

const smsClient = {
  companyId: "7648b78d-836f-489e-ada1-9dcea8b22220",
  accountSid: `AC${"a".repeat(32)}`,
  apiKeySid: `SK${"b".repeat(32)}`,
  apiKeySecret: "secret",
  authToken: "token",
};

describe("scheduleGates", () => {
  it("leaves every gated schedule out of an unconfigured deployment", () => {
    for (const gate of Object.values(scheduleGates)) expect(gate({})).toBe(false);
  });

  it("schedules the setter callback SLA only when its flag is exactly true", () => {
    expect(scheduleGates.setterCallbackSla({ SETTER_CALLBACK_SLA_ENABLED: "true" })).toBe(true);
    expect(scheduleGates.setterCallbackSla({ SETTER_CALLBACK_SLA_ENABLED: "1" })).toBe(false);
    expect(scheduleGates.setterCallbackSla({ SETTER_CALLBACK_SLA_ENABLED: "false" })).toBe(false);
  });

  it("schedules approved booking texts only with a valid SMS client registry", () => {
    expect(scheduleGates.approvedBookingSms({
      TWILIO_SMS_CLIENTS_JSON: JSON.stringify([smsClient]),
    })).toBe(true);
    expect(scheduleGates.approvedBookingSms({ TWILIO_SMS_CLIENTS_JSON: "[]" })).toBe(false);
    expect(scheduleGates.approvedBookingSms({ TWILIO_SMS_CLIENTS_JSON: "not json" })).toBe(false);
  });

  it("schedules estimate delivery when either channel has a webhook", () => {
    expect(scheduleGates.estimateDeliverySender({
      ESTIMATE_EMAIL_WEBHOOK_URL: "https://hooks.example.com/email",
    })).toBe(true);
    expect(scheduleGates.estimateDeliverySender({
      ESTIMATE_SMS_WEBHOOK_URL: "https://hooks.example.com/sms",
    })).toBe(true);
    expect(scheduleGates.estimateDeliverySender({
      ESTIMATE_SMS_WEBHOOK_URL: "  ",
      ESTIMATE_EMAIL_WEBHOOK_URL: "",
    })).toBe(false);
  });

  it("schedules the access route reader when either vendor read is enabled", () => {
    expect(scheduleGates.accessRouteReadSync({ INTEGRATIONS_LEADMASTER_ENABLED: "true" })).toBe(true);
    expect(scheduleGates.accessRouteReadSync({ INTEGRATIONS_JOBNIMBUS_ENABLED: "true" })).toBe(true);
    expect(scheduleGates.accessRouteReadSync({
      INTEGRATIONS_LEADMASTER_ENABLED: "false",
      INTEGRATIONS_JOBNIMBUS_ENABLED: "false",
    })).toBe(false);
  });
});

describe("estimateWebhookConfigured", () => {
  it("checks each channel's own webhook", () => {
    const environment = { ESTIMATE_SMS_WEBHOOK_URL: "https://hooks.example.com/sms" };
    expect(estimateWebhookConfigured("sms", environment)).toBe(true);
    expect(estimateWebhookConfigured("email", environment)).toBe(false);
  });
});

describe("onlyWhen", () => {
  it("includes the function only when enabled", () => {
    expect(onlyWhen(true, "fn")).toEqual(["fn"]);
    expect(onlyWhen(false, "fn")).toEqual([]);
  });
});
