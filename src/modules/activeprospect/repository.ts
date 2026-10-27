import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import type {Database} from "@/lib/database.types";
import {eventEnvelopeSchema} from "@/domain/events";
import type {IntakeBinding} from "./config";
import type {IntakeAcceptance} from "./intake-http";
import {IntakeReplayConflict, type ActiveProspectPayload} from "./payload";

const resultSchema = z.array(z.object({
  receipt_id: z.uuid(), state: z.enum(["accepted", "linked", "test", "external", "needs_review", "ownership_conflict"]),
  lead_id: z.uuid().nullable(), duplicate: z.boolean(), event: eventEnvelopeSchema.nullable(),
})).length(1);

export async function acceptActiveProspectIntake(
  client: SupabaseClient<Database>, binding: IntakeBinding, payload: ActiveProspectPayload,
): Promise<IntakeAcceptance> {
  const {data, error} = await client.rpc("accept_activeprospect_booking_intake", {
    p_company_id: binding.companyId, p_flow_id: binding.flowId,
    p_appointment_type: binding.appointmentType, p_contact_owner: binding.contactOwner,
    p_payload: payload,
  });
  if (error?.code === "22000" && error.message === "ActiveProspect replay conflict") throw new IntakeReplayConflict();
  if (error) throw new Error("ActiveProspect intake persistence failed");
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) throw new Error("ActiveProspect intake returned an invalid result");
  const row = parsed.data[0];
  return {receiptId: row.receipt_id, state: row.state, leadId: row.lead_id, duplicate: row.duplicate, event: row.event};
}
