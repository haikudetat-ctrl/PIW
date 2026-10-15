import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { toUsE164 } from "@/modules/sms/rules";
import type { LeadConduitFlowBinding } from "./leadconduit-config";
import type { LeadConduitShadowPayload } from "./leadconduit-shadow-receipt";
import { normalizeEmail } from "./normalize";

// A lead that reached the `delivered` checkpoint passed every filter in the
// flow; Rake takes it in so the call center works it from the Rake queue.

export type LeadConduitLeadIntake = {
  companyId: string;
  flowId: string;
  flowName: string;
  leadConduitLeadId: string;
  piwLeadId: string | null;
  name: string;
  phone: string;
  phoneE164: string | null;
  email: string;
  emailNormalized: string | null;
  submittedAddress: string;
  sourceName: string | null;
  trustedformUrl: string | null;
  isTest: boolean;
};

export type LeadConduitLeadIntakeOutcome =
  | "created"
  | "existing_piw_lead"
  | "existing_leadconduit_lead"
  | "matched_contact"
  | "incomplete_contact";

function present(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

// Rake needs a name, a phone to call, an email and an address (the leads table
// requires all four). A delivered lead missing any of them stays in LeadConduit.
export function toLeadConduitLeadIntake(
  binding: Pick<LeadConduitFlowBinding, "companyId" | "flowId" | "flowName">,
  payload: LeadConduitShadowPayload,
): LeadConduitLeadIntake | null {
  const name = present(payload.lead.name);
  const phone = present(payload.lead.phone);
  const email = present(payload.lead.email);
  const submittedAddress = present(payload.lead.submitted_address);
  if (!name || !phone || !email || !submittedAddress) return null;

  return {
    companyId: binding.companyId,
    flowId: binding.flowId,
    flowName: binding.flowName,
    leadConduitLeadId: payload.lead_id,
    piwLeadId: payload.piw_lead_id ?? null,
    name,
    phone,
    phoneE164: toUsE164(phone),
    email,
    emailNormalized: normalizeEmail(email),
    submittedAddress,
    sourceName: present(payload.source.name) ?? present(payload.source.id),
    trustedformUrl: present(payload.lead.trustedform_url),
    isTest: payload.is_test,
  };
}

const RPC_OUTCOMES = new Set<LeadConduitLeadIntakeOutcome>([
  "created",
  "existing_piw_lead",
  "existing_leadconduit_lead",
  "matched_contact",
]);

export async function intakeLeadConduitLead(
  database: SupabaseClient<Database>,
  input: LeadConduitLeadIntake,
  correlationId: string = crypto.randomUUID(),
): Promise<LeadConduitLeadIntakeOutcome> {
  // Nullable SQL parameters; the generated Args type marks them as required text.
  const nullable = (value: string | null) => value as string;
  const { data, error } = await database.rpc("intake_leadconduit_lead", {
    p_company_id: input.companyId,
    p_flow_id: input.flowId,
    p_flow_name: input.flowName,
    p_leadconduit_lead_id: input.leadConduitLeadId,
    p_piw_lead_id: nullable(input.piwLeadId),
    p_name: input.name,
    p_phone: input.phone,
    p_phone_e164: nullable(input.phoneE164),
    p_email: input.email,
    p_email_normalized: nullable(input.emailNormalized),
    p_submitted_address: input.submittedAddress,
    p_source_name: nullable(input.sourceName),
    p_trustedform_url: nullable(input.trustedformUrl),
    p_is_test: input.isTest,
    p_correlation_id: correlationId,
  });
  const outcome = data?.[0]?.outcome as LeadConduitLeadIntakeOutcome | undefined;
  if (error || !outcome || !RPC_OUTCOMES.has(outcome)) {
    throw new Error("LeadConduit lead intake failed", { cause: error });
  }
  return outcome;
}
