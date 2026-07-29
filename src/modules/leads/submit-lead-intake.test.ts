import { expect, test, vi } from "vitest";
import { submitLeadIntake } from "./submit-lead-intake";

test("creates lead records before enqueueing the submitted event", async () => {
  const createLeadRecords = vi.fn().mockResolvedValue({
    leadId: "lead-1",
    propertyId: "property-1",
    pipelineRunId: "run-1",
  });
  const enqueueLeadSubmitted = vi.fn().mockResolvedValue(undefined);

  const input = {
    name: "Jordan Rivera",
    phone: "555-010-1000",
    email: "jordan@example.com",
    submittedAddress: "12 Birch St, Trenton, NJ",
  };

  const result = await submitLeadIntake(input, { createLeadRecords, enqueueLeadSubmitted });

  expect(result).toEqual({
    leadId: "lead-1",
    propertyId: "property-1",
    pipelineRunId: "run-1",
    correlationId: expect.any(String),
  });
  expect(createLeadRecords).toHaveBeenCalledWith({ ...input, correlationId: result.correlationId });
  expect(enqueueLeadSubmitted).toHaveBeenCalledWith({
    leadId: "lead-1",
    propertyId: "property-1",
    pipelineRunId: "run-1",
    correlationId: result.correlationId,
    lead: input,
  });
});
