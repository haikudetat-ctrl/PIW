import { z } from "zod";

export const leadIntakeInputSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email(),
  submittedAddress: z.string().min(1),
  notes: z.string().optional(),
});

export type LeadIntakeInput = z.infer<typeof leadIntakeInputSchema>;

export type LeadIntakeResult = {
  leadId: string;
  propertyId: string;
  pipelineRunId: string;
  correlationId: string;
};

export type SubmitLeadIntakeDependencies = {
  createLeadRecords: (
    input: LeadIntakeInput & { correlationId: string },
  ) => Promise<{ leadId: string; propertyId: string; pipelineRunId: string }>;
  enqueueLeadSubmitted: (input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    correlationId: string;
    lead: LeadIntakeInput;
  }) => Promise<void>;
};

export async function submitLeadIntake(
  input: LeadIntakeInput,
  deps: SubmitLeadIntakeDependencies,
): Promise<LeadIntakeResult> {
  const correlationId = crypto.randomUUID();
  const { leadId, propertyId, pipelineRunId } = await deps.createLeadRecords({
    ...input,
    correlationId,
  });

  await deps.enqueueLeadSubmitted({ leadId, propertyId, pipelineRunId, correlationId, lead: input });

  return { leadId, propertyId, pipelineRunId, correlationId };
}
