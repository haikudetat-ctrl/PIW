// @vitest-environment node
import {expect, test, vi} from "vitest";
import {handleActiveProspectIntake} from "./intake-http";
import {IntakeReplayConflict} from "./payload";

const binding = {slug: "client-a-virtual", companyId: "11111111-1111-4111-8111-111111111111", flowId: "flow-a", appointmentType: "virtual" as const, contactOwner: "piw" as const, enabled: true, tokens: [{value: "a-token-with-at-least-32-characters", validUntil: null}]};
const payload = {schema_version: 1, lead_id: "vendor-1", flow_id: "flow-a", submitted_at: "2026-10-27T14:00:00Z", is_test: false, source: {id: "source-1", name: "Vendor"}, lead: {name: "Dana", phone: "(609) 555-0101", email: "DANA@example.com", submitted_address: "1 Test Lane"}};
const accepted = {receiptId: "33333333-3333-4333-8333-333333333333", state: "accepted", leadId: "44444444-4444-4444-8444-444444444444", duplicate: false, event: null};
function deps(overrides = {}) {
  return {getBinding: () => binding, accept: vi.fn(async () => accepted), publish: vi.fn(async () => undefined), now: () => new Date("2026-10-27T14:01:00Z"), ...overrides};
}
function request(body: unknown = payload, token = binding.tokens[0].value, contentType = "application/json") {
  return new Request("https://piw.example/api/integrations/activeprospect/client-a-virtual", {method: "POST", headers: {authorization: `Bearer ${token}`, "content-type": contentType}, body: JSON.stringify(body)});
}

test("persists normalized input using only the server binding", async () => {
  const d = deps();
  const result = await handleActiveProspectIntake(request(), binding.slug, d);
  expect(result.status).toBe(200);
  expect(d.accept).toHaveBeenCalledWith(binding, expect.objectContaining({lead: expect.objectContaining({phone: "+16095550101", email: "dana@example.com"})}));
  expect(result.body).not.toHaveProperty("leadId");
});

test("retains incomplete contact submissions for review instead of inventing fields", async () => {
  const d = deps();
  expect((await handleActiveProspectIntake(request({...payload, lead: {phone: "+16095550101"}}), binding.slug, d)).status).toBe(200);
  expect(d.accept).toHaveBeenCalledWith(binding, expect.objectContaining({lead: {name: null, phone: "+16095550101", email: null, submitted_address: null}}));
});

test("rejects disabled, expired-token, wrong-token and cross-flow input before persistence", async () => {
  const d = deps();
  expect((await handleActiveProspectIntake(request(payload, "wrong"), binding.slug, d)).status).toBe(401);
  expect((await handleActiveProspectIntake(request({...payload, flow_id: "flow-b"}), binding.slug, d)).status).toBe(401);
  expect((await handleActiveProspectIntake(request(), binding.slug, deps({getBinding: () => ({...binding, enabled: false})}))).status).toBe(503);
  expect((await handleActiveProspectIntake(request(), binding.slug, deps({getBinding: () => ({...binding, tokens: [{value: binding.tokens[0].value, validUntil: "2026-10-26T00:00:00Z"}]})}))).status).toBe(401);
  expect(d.accept).not.toHaveBeenCalled();
});

test("rejects spoofed tenant/owner, invalid JSON, oversized and wrongly typed bodies", async () => {
  const d = deps();
  for (const extra of [{company_id: binding.companyId}, {contact_owner: "piw"}, {is_test: "false"}]) {
    expect((await handleActiveProspectIntake(request({...payload, ...extra}), binding.slug, d)).status).toBe(400);
  }
  expect((await handleActiveProspectIntake(request(payload, binding.tokens[0].value, "text/plain"), binding.slug, d)).status).toBe(400);
  expect((await handleActiveProspectIntake(request({...payload, extra: "x".repeat(65536)}), binding.slug, d)).status).toBe(413);
  const invalidJson = new Request("https://piw.example/intake", {method: "POST", headers: {authorization: `Bearer ${binding.tokens[0].value}`, "content-type": "application/json"}, body: "{"});
  expect((await handleActiveProspectIntake(invalidJson, binding.slug, d)).status).toBe(400);
  expect((await handleActiveProspectIntake(request({...payload, sms_consent: {granted: true, company_id: "22222222-2222-4222-8222-222222222222"}}), binding.slug, d)).status).toBe(401);
  expect(d.accept).not.toHaveBeenCalled();
});

test("identical replays return the receipt while changed replays return a conflict", async () => {
  const replay = deps({accept: vi.fn(async () => ({...accepted, duplicate: true}))});
  expect((await handleActiveProspectIntake(request(), binding.slug, replay)).body).toMatchObject({receipt_id: accepted.receiptId, duplicate: true});
  const changed = deps({accept: vi.fn(async () => {throw new IntakeReplayConflict();})});
  expect(await handleActiveProspectIntake(request(), binding.slug, changed)).toEqual({status: 409, body: {outcome: "conflict", category: "replay_changed"}});
});

test("does not expose persistence errors and returns retryable failure", async () => {
  const d = deps({accept: vi.fn(async () => {throw new Error("private database payload");})});
  expect(await handleActiveProspectIntake(request(), binding.slug, d)).toEqual({status: 503, body: {outcome: "retry", category: "persistence"}});
});

test("acknowledges durable acceptance even if immediate publishing fails", async () => {
  const d = deps({accept: vi.fn(async () => ({...accepted, event: {id: "persisted-event"}})), publish: vi.fn(async () => {throw new Error("offline");})});
  expect((await handleActiveProspectIntake(request(), binding.slug, d)).status).toBe(200);
});
