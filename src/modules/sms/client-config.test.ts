// @vitest-environment node
import {expect, test, vi} from "vitest";

vi.mock("server-only", () => ({}));
const {resolveSmsClient, sendCompanySms} = await import("./client-config");

const first = {
  companyId: "11111111-1111-4111-8111-111111111111",
  accountSid: `AC${"1".repeat(32)}`,
  apiKeySid: `SK${"2".repeat(32)}`,
  apiKeySecret: "client-one-key-secret",
  authToken: "client-one-auth-token",
};
const second = {...first, companyId: "22222222-2222-4222-8222-222222222222", accountSid: `AC${"3".repeat(32)}`, apiKeySid: `SK${"4".repeat(32)}`, apiKeySecret: "client-two-key-secret", authToken: "client-two-auth-token"};
const environment = {TWILIO_SMS_CLIENTS_JSON: JSON.stringify([first, second])};

test("resolves a company and a webhook account to their own client binding", () => {
  expect(resolveSmsClient({companyId: first.companyId}, environment)).toEqual(first);
  expect(resolveSmsClient({accountSid: second.accountSid}, environment)).toEqual(second);
  expect(resolveSmsClient({companyId: "unknown"}, environment)).toBeNull();
  expect(resolveSmsClient({accountSid: `AC${"9".repeat(32)}`}, environment)).toBeNull();
});

test.each([
  undefined, "", "not JSON", "{}", "[]",
  JSON.stringify([{...first, accountSid: "not-an-account"}]),
  JSON.stringify([{...first, authToken: " "}]),
  JSON.stringify([{...first, apiKeySid: "bad"}]),
  JSON.stringify([{...first, companyId: "invalid"}]),
  JSON.stringify([first, {...second, companyId: first.companyId}]),
  JSON.stringify([first, {...second, accountSid: first.accountSid}]),
])("fails closed for an absent, malformed or ambiguous registry (%#)", (raw) => {
  expect(resolveSmsClient({companyId: first.companyId}, {TWILIO_SMS_CLIENTS_JSON: raw})).toBeNull();
});

test("never falls back to global credentials for an unmapped company", async () => {
  const fetchImpl = vi.fn();
  await expect(sendCompanySms("unknown", {messagingServiceSid: `MG${"5".repeat(32)}`, to: "+16095550101", body: "Hello", statusCallback: null}, environment, fetchImpl)).rejects.toThrow("Texting is not configured for this company");
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("sends each client's message to its subaccount with that subaccount's API key", async () => {
  const fetchImpl = vi.fn(async () => Response.json({sid: `SM${"a".repeat(32)}`, status: "queued"}, {status: 201}));
  const input = {messagingServiceSid: `MG${"5".repeat(32)}`, to: "+16095550101", body: "Hello", statusCallback: null};
  await sendCompanySms(first.companyId, input, environment, fetchImpl);
  await sendCompanySms(second.companyId, {...input, messagingServiceSid: `MG${"6".repeat(32)}`}, environment, fetchImpl);
  const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
  expect(calls.map(([url]) => url)).toEqual([
    `https://api.twilio.com/2010-04-01/Accounts/${first.accountSid}/Messages.json`,
    `https://api.twilio.com/2010-04-01/Accounts/${second.accountSid}/Messages.json`,
  ]);
  expect(calls[0][1].headers).toMatchObject({authorization: `Basic ${Buffer.from(`${first.apiKeySid}:${first.apiKeySecret}`).toString("base64")}`});
  expect(calls[1][1].headers).toMatchObject({authorization: `Basic ${Buffer.from(`${second.apiKeySid}:${second.apiKeySecret}`).toString("base64")}`});
  expect(new URLSearchParams(String(calls[1][1].body)).get("MessagingServiceSid")).toBe(`MG${"6".repeat(32)}`);
});
