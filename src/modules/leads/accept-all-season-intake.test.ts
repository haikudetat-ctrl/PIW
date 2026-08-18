import { expect, test, vi } from "vitest";
import { acceptAllSeasonIntake } from "./accept-all-season-intake";

const payload = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  name: "Alex Rivera",
  email: "Alex@Example.com",
  phone: "(201) 555-0100",
  submittedAddress: "1 Main St, Newark, NJ",
  serviceRequested: "solar" as const,
  submittedAt: "2026-08-18T14:00:00.000Z",
  attribution: {
    fbclid: "click-123",
    fbp: "fb.1.100.200",
    fbc: "fb.1.100.click",
  },
};

test("creates and enqueues a new All Season lead", async () => {
  const createLeadRecords = vi.fn(async () => ({
    leadId: "22222222-2222-4222-8222-222222222222",
    propertyId: "33333333-3333-4333-8333-333333333333",
    pipelineRunId: "44444444-4444-4444-8444-444444444444",
    duplicate: false,
  }));
  const enqueueLeadSubmitted = vi.fn(async () => undefined);

  const result = await acceptAllSeasonIntake(payload, {
    createLeadRecords,
    enqueueLeadSubmitted,
  });

  expect(result).toEqual({
    leadId: "22222222-2222-4222-8222-222222222222",
    duplicate: false,
  });
  expect(createLeadRecords).toHaveBeenCalledWith(expect.objectContaining({
    correlationId: payload.submissionId,
    externalLeadId: payload.submissionId,
    emailNormalized: "alex@example.com",
    phoneE164: "+12015550100",
    serviceRequested: "solar",
  }));
  expect(enqueueLeadSubmitted).toHaveBeenCalledWith(expect.objectContaining({
    correlationId: payload.submissionId,
    serviceRequested: "solar",
  }));
});

test("retries the idempotent event enqueue for a duplicate submission", async () => {
  const enqueueLeadSubmitted = vi.fn(async () => undefined);

  const result = await acceptAllSeasonIntake(payload, {
    createLeadRecords: async () => ({
      leadId: "22222222-2222-4222-8222-222222222222",
      propertyId: "33333333-3333-4333-8333-333333333333",
      pipelineRunId: "44444444-4444-4444-8444-444444444444",
      duplicate: true,
    }),
    enqueueLeadSubmitted,
  });

  expect(result).toEqual({
    leadId: "22222222-2222-4222-8222-222222222222",
    duplicate: true,
  });
  expect(enqueueLeadSubmitted).toHaveBeenCalledWith(expect.objectContaining({
    leadId: "22222222-2222-4222-8222-222222222222",
    duplicate: true,
    correlationId: payload.submissionId,
  }));
});
