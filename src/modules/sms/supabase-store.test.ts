// @vitest-environment node
import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const {createSmsWebhookStore, phoneVariants, smsWebhookUrls} = await import("./supabase-store");
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";

test("matches the ways a US number is typed into a lead", () => {
  expect(phoneVariants("+18565550142")).toEqual([
    "+18565550142",
    "8565550142",
    "18565550142",
    "(856) 555-0142",
    "856-555-0142",
    "856.555.0142",
  ]);
  expect(phoneVariants("+442071234567")).toEqual(["+442071234567"]);
});

test("checks signatures against the request URL and the production URL", () => {
  expect(smsWebhookUrls("https://piw-abc.vercel.app/api/twilio/sms", "/api/twilio/sms", "app.rake.example")).toEqual([
    "https://piw-abc.vercel.app/api/twilio/sms",
    "https://app.rake.example/api/twilio/sms",
  ]);
  expect(smsWebhookUrls("https://x/api/twilio/sms", "/api/twilio/sms", undefined)).toEqual(["https://x/api/twilio/sms"]);
});

test("scopes number and message lookup and delivery mutations to the verified company", async () => {
  const filters: [string, unknown][] = [];
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    maybeSingle: async () => ({data: null}),
    update: () => query,
    then: (resolve: (value: {error: null}) => unknown) => Promise.resolve(resolve({error: null})),
  };
  const service = {from: () => query} as unknown as SupabaseClient<Database>;
  const store = createSmsWebhookStore(service, "company-a");
  await store.findCompanyByNumber("+16095550199");
  expect(filters).toContainEqual(["company_id", "company-a"]);
  filters.length = 0;
  await store.findBySid(`SM${"a".repeat(32)}`);
  expect(filters).toContainEqual(["company_id", "company-a"]);
  filters.length = 0;
  await store.updateStatus("message-a", "delivered", null);
  expect(filters).toContainEqual(["company_id", "company-a"]);
});

test("refuses cross-company writes even if a caller passes another company", async () => {
  const from = vi.fn();
  const store = createSmsWebhookStore({from} as unknown as SupabaseClient<Database>, "company-a");
  await expect(store.suppress("company-b", "+16095550101")).rejects.toThrow("SMS company mismatch");
  await expect(store.unsuppress("company-b", "+16095550101")).rejects.toThrow("SMS company mismatch");
  await expect(store.findLeadByPhone("company-b", "+16095550101")).rejects.toThrow("SMS company mismatch");
  await expect(store.insertInbound({company_id: "company-b", lead_id: null, direction: "inbound", body: "STOP", from_e164: "+16095550101", to_e164: "+16095550199", status: "received", provider_sid: `SM${"a".repeat(32)}`})).rejects.toThrow("SMS company mismatch");
  expect(from).not.toHaveBeenCalled();
});
