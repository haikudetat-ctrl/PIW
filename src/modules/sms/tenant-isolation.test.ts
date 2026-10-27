// @vitest-environment node
import {afterEach, beforeEach, expect, test, vi} from "vitest";
import {NextRequest} from "next/server";

vi.mock("server-only", () => ({}));
const database = vi.hoisted(() => ({tables: {} as Record<string, Record<string, unknown>[]>}));
// Only the network/database boundary is replaced. Both route handlers, signature
// validation, business handlers and the scoped Supabase store are real.
vi.mock("@/lib/supabase/service", () => ({createServiceClient: () => ({
  from(table: string) {
    const filters: [string, unknown][] = [];
    let patch: Record<string, unknown> | null = null;
    let inserted: Record<string, unknown> | null = null;
    const matching = () => (database.tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {filters.push([key, value]); return query;},
      or: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({data: matching()[0] ?? null, error: null}),
      update: (value: Record<string, unknown>) => {patch = value; return query;},
      insert: (value: Record<string, unknown>) => {inserted = value; return query;},
      upsert: (value: Record<string, unknown>) => {inserted = value; return query;},
      then(resolve: (result: {data: Record<string, unknown>[]; error: null}) => unknown) {
        const rows = matching();
        if (patch) rows.forEach((row) => Object.assign(row, patch));
        if (inserted) (database.tables[table] ??= []).push(inserted);
        return Promise.resolve(resolve({data: rows, error: null}));
      },
    };
    return query;
  },
})}));

const {POST: inbound} = await import("@/app/api/twilio/sms/route");
const {POST: status} = await import("@/app/api/twilio/sms/status/route");
const {twilioSignature} = await import("./twilio");
const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_A = `AC${"1".repeat(32)}`;
const SID_A = `SM${"a".repeat(32)}`;
const SID_B = `SM${"b".repeat(32)}`;

beforeEach(() => {
  database.tables = {
    company_sms_settings: [{company_id: COMPANY_A, from_e164: "+16095550101"}, {company_id: COMPANY_B, from_e164: "+16095550102"}],
    sms_messages: [{id: "message-a", company_id: COMPANY_A, provider_sid: SID_A, status: "sent"}, {id: "message-b", company_id: COMPANY_B, provider_sid: SID_B, status: "sent"}],
    leads: [], suppression_list: [],
  };
  vi.stubEnv("SMS_ENABLED", "false");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("TWILIO_SMS_CLIENTS_JSON", JSON.stringify([
    {companyId: COMPANY_A, accountSid: ACCOUNT_A, apiKeySid: `SK${"2".repeat(32)}`, apiKeySecret: "key-a", authToken: "token-a"},
    {companyId: COMPANY_B, accountSid: `AC${"3".repeat(32)}`, apiKeySid: `SK${"4".repeat(32)}`, apiKeySecret: "key-b", authToken: "token-b"},
  ]));
});
afterEach(() => vi.unstubAllEnvs());

function signedRequest(path: string, values: Record<string, string>) {
  const url = `https://piw.example/api/twilio/sms${path}`;
  const params = {AccountSid: ACCOUNT_A, ...values};
  return new NextRequest(url, {method: "POST", body: new URLSearchParams(params), headers: {"x-twilio-signature": twilioSignature("token-a", url, params)}});
}

test("a valid client A signature cannot record or suppress a reply to client B's number", async () => {
  const params = {MessageSid: `SM${"c".repeat(32)}`, From: "+16095550199", To: "+16095550102", Body: "STOP"};
  expect((await inbound(signedRequest("", params))).status).toBe(200);
  expect(database.tables.sms_messages).toHaveLength(2);
  expect(database.tables.suppression_list).toEqual([]);
  // Control: the same signature/account can record a reply to its own number.
  expect((await inbound(signedRequest("", {...params, To: "+16095550101"}))).status).toBe(200);
  expect(database.tables.sms_messages[2]).toMatchObject({company_id: COMPANY_A, body: "STOP"});
  expect(database.tables.suppression_list).toMatchObject([{company_id: COMPANY_A, phone_e164: "+16095550199"}]);
});

test("a valid client A signature cannot change client B's delivery status", async () => {
  expect((await status(signedRequest("/status", {MessageSid: SID_B, MessageStatus: "delivered"}))).status).toBe(204);
  expect(database.tables.sms_messages[1].status).toBe("sent");
  // Control: an owned message is updated by the real status handler/store.
  expect((await status(signedRequest("/status", {MessageSid: SID_A, MessageStatus: "delivered"}))).status).toBe(204);
  expect(database.tables.sms_messages[0].status).toBe("delivered");
  expect(database.tables.sms_messages[1].status).toBe("sent");
});
