import { expect, test, vi } from "vitest";
import type { DomainEvent } from "@/domain/events";
import { acceptAllSeasonCampaignEstimate } from "./accept-all-season-campaign-estimate";

const payload = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  campaign: "do-it-right-once",
  name: "Alex Rivera",
  email: "alex@example.com",
  phone: "201-555-0100",
  submittedAddress: "1 Main St, Newark, NJ 07102, USA",
  googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  clientIpAddress: "203.0.113.10",
  clientUserAgent: "homeowner-browser",
  submittedAt: "2026-08-24T14:00:00.000Z",
  attribution: {
    utm_source: "facebook",
    utm_medium: "paid-social",
    utm_campaign: "20y",
    utm_term: null,
    utm_content: "receipt",
    fbclid: "click-123",
    fbp: "fb.1.100.200",
    fbc: "fb.1.100.click",
  },
};

const persistedEvent: DomainEvent = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "crm/lead.submitted",
  schemaVersion: 1,
  correlationId: payload.submissionId,
  leadId: "22222222-2222-4222-8222-222222222222",
  propertyId: "33333333-3333-4333-8333-333333333333",
  pipelineRunId: "44444444-4444-4444-8444-444444444444",
  occurredAt: "2026-08-24T14:00:00.000Z",
  idempotencyKey: "crm/lead.submitted:44444444-4444-4444-8444-444444444444",
  data: {
    leadId: "22222222-2222-4222-8222-222222222222",
    propertyId: "33333333-3333-4333-8333-333333333333",
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    submittedAddress: payload.submittedAddress,
    googlePlaceId: payload.googlePlaceId,
    serviceRequested: "roofing",
    notes: "Submitted through the do-it-right-once All Season campaign.",
  },
};

test("creates and enqueues a fully attributed roofing estimate", async () => {
  const createEstimateRecords = vi.fn(async () => ({
    leadId: "22222222-2222-4222-8222-222222222222",
    propertyId: "33333333-3333-4333-8333-333333333333",
    pipelineRunId: "44444444-4444-4444-8444-444444444444",
    publicToken: "55555555-5555-4555-8555-555555555555",
    event: persistedEvent,
  }));
  const publishPersistedLeadSubmitted = vi.fn(async () => undefined);

  const result = await acceptAllSeasonCampaignEstimate(payload, {
    createEstimateRecords,
    publishPersistedLeadSubmitted,
  });

  expect(result).toEqual({
    leadId: "22222222-2222-4222-8222-222222222222",
    publicToken: "55555555-5555-4555-8555-555555555555",
    resultPath: "/roof-estimate/55555555-5555-4555-8555-555555555555",
  });
  expect(createEstimateRecords).toHaveBeenCalledWith(expect.objectContaining({
    correlationId: payload.submissionId,
    disclosureVersion: "all-season-campaign-estimate-v1",
    submittedAddress: payload.submittedAddress,
    googlePlaceId: payload.googlePlaceId,
  }));
  expect(publishPersistedLeadSubmitted).toHaveBeenCalledOnce();
  expect(publishPersistedLeadSubmitted).toHaveBeenCalledWith(persistedEvent);
});

test("does not republish a duplicate submission because its outbox event already exists", async () => {
  const publishPersistedLeadSubmitted = vi.fn(async () => undefined);

  const result = await acceptAllSeasonCampaignEstimate(payload, {
    createEstimateRecords: async () => ({
      leadId: "22222222-2222-4222-8222-222222222222",
      propertyId: "33333333-3333-4333-8333-333333333333",
      pipelineRunId: "44444444-4444-4444-8444-444444444444",
      publicToken: "55555555-5555-4555-8555-555555555555",
      event: persistedEvent,
      isDuplicate: true,
    }),
    publishPersistedLeadSubmitted,
  });

  expect(result).toEqual({
    leadId: "22222222-2222-4222-8222-222222222222",
    publicToken: "55555555-5555-4555-8555-555555555555",
    resultPath: "/roof-estimate/55555555-5555-4555-8555-555555555555",
  });
  expect(publishPersistedLeadSubmitted).not.toHaveBeenCalled();
});
