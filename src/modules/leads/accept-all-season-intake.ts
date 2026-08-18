import { normalizeEmailForMatching, normalizePhoneToE164 } from "./normalize-contact";

export type AllSeasonServiceRequested = "roofing" | "solar" | "both";

export type AllSeasonLeadInput = {
  submissionId: string;
  name: string;
  email: string;
  phone: string;
  submittedAddress: string;
  serviceRequested: AllSeasonServiceRequested;
  submittedAt: string;
  attribution: {
    fbclid: string | null;
    fbp: string | null;
    fbc: string | null;
  };
};

type CreatedLeadRecords = {
  leadId: string;
  propertyId: string;
  pipelineRunId: string;
  duplicate: boolean;
};

export type AcceptAllSeasonIntakeDependencies = {
  createLeadRecords: (input: AllSeasonLeadInput & {
    correlationId: string;
    externalLeadId: string;
    emailNormalized: string;
    phoneE164: string | null;
    disclosureVersion: string;
  }) => Promise<CreatedLeadRecords>;
  enqueueLeadSubmitted: (input: AllSeasonLeadInput & CreatedLeadRecords & {
    correlationId: string;
  }) => Promise<void>;
};

export async function acceptAllSeasonIntake(
  input: AllSeasonLeadInput,
  dependencies: AcceptAllSeasonIntakeDependencies,
) {
  const correlationId = input.submissionId;
  const created = await dependencies.createLeadRecords({
    ...input,
    correlationId,
    externalLeadId: input.submissionId,
    emailNormalized: normalizeEmailForMatching(input.email),
    phoneE164: normalizePhoneToE164(input.phone),
    disclosureVersion: "all-season-quote-v1",
  });

  await dependencies.enqueueLeadSubmitted({
    ...input,
    ...created,
    correlationId,
  });

  return { leadId: created.leadId, duplicate: created.duplicate };
}
