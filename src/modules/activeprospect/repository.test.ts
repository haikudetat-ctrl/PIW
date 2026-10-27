// @vitest-environment node
import {expect, test, vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";
import {createEventEnvelope} from "@/domain/events";
import {acceptActiveProspectIntake} from "./repository";
import {activeProspectPayloadSchema, IntakeReplayConflict} from "./payload";

const company = "11111111-1111-4111-8111-111111111111";
const lead = "22222222-2222-4222-8222-222222222222";
const property = "33333333-3333-4333-8333-333333333333";
const pipeline = "44444444-4444-4444-8444-444444444444";
const receipt = "55555555-5555-4555-8555-555555555555";
const binding = {slug: "client-virtual", companyId: company, flowId: "flow-one", appointmentType: "virtual" as const, contactOwner: "piw" as const, enabled: true, tokens: [{value: "token-with-at-least-thirty-two-characters", validUntil: null}]};
const payload = activeProspectPayloadSchema.parse({schema_version: 1, lead_id: "vendor-one", flow_id: "flow-one", submitted_at: "2026-10-27T14:00:00Z", is_test: false, source: {id: "source", name: "Vendor"}, lead: {name: "Dana", phone: "+16095550101", email: "dana@example.com", submitted_address: "1 Test Lane"}});

test("uses the bound tenant and parses the persisted event for the durable publisher", async () => {
  const event = createEventEnvelope({name: "crm/lead.submitted", correlationId: receipt, pipelineRunId: pipeline, leadId: lead, propertyId: property, data: {leadId: lead, propertyId: property, name: "Dana", phone: "+16095550101", email: "dana@example.com", submittedAddress: "1 Test Lane", serviceRequested: "roofing"}});
  const rpc = vi.fn(async () => ({error: null, data: [{receipt_id: receipt, lead_id: lead, state: "accepted", duplicate: false, event}]}));
  const result = await acceptActiveProspectIntake({rpc} as unknown as SupabaseClient<Database>, binding, payload);
  expect(rpc).toHaveBeenCalledWith("accept_activeprospect_booking_intake", {p_company_id: company, p_flow_id: "flow-one", p_appointment_type: "virtual", p_contact_owner: "piw", p_payload: payload});
  expect(result).toEqual({receiptId: receipt, leadId: lead, state: "accepted", duplicate: false, event});
});

test("maps only the known replay conflict and rejects malformed database results", async () => {
  const client = (data: unknown, error: unknown) => ({rpc: async () => ({data, error})}) as unknown as SupabaseClient<Database>;
  await expect(acceptActiveProspectIntake(client(null, {code: "22000", message: "ActiveProspect replay conflict"}), binding, payload)).rejects.toBeInstanceOf(IntakeReplayConflict);
  await expect(acceptActiveProspectIntake(client([], null), binding, payload)).rejects.toThrow("invalid result");
  await expect(acceptActiveProspectIntake(client(null, {code: "XX000", message: "private contact details"}), binding, payload)).rejects.toThrow("ActiveProspect intake persistence failed");
});
