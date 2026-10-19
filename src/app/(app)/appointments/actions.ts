"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createEventEnvelope, eventEnvelopeSchema } from "@/domain/events";
import { inngest } from "@/inngest/client";
import { canUseCrm, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { enqueueAndPublishEvent } from "@/modules/events/enqueue-and-publish-event";
import {
  ensureBookingUrl,
  isVirtualBookingAvailable,
  resolveBookingConfiguration,
} from "@/modules/booking/booking-runtime";

const optionalFormText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().optional(),
);

const appointmentInputSchema = z.object({
  scheduledAt: z.iso.datetime(),
  durationMinutes: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  status: z
    .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
    .default("scheduled"),
  notes: optionalFormText,
});

const assignmentInputSchema = z.object({
  companyId: z.uuid(),
  appointmentId: z.uuid(),
  repId: z.uuid(),
});

export async function createAppointment(leadId: string, formData: FormData) {
  const parsedLeadId = z.uuid().parse(leadId);
  const input = appointmentInputSchema.parse(Object.fromEntries(formData));
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Authentication required");

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) throw new Error("Admin profile required");

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      company_id: adminProfile.company_id,
      lead_id: parsedLeadId,
      scheduled_at: input.scheduledAt,
      duration_minutes: input.durationMinutes,
      status: input.status,
      notes: input.notes,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("Failed to create appointment");

  revalidatePath(`/leads/${parsedLeadId}`);
  return { appointmentId: data.id };
}

export async function assignAppointmentRep(
  companyId: string,
  appointmentId: string,
  repId: string,
) {
  const input = assignmentInputSchema.parse({ companyId, appointmentId, repId });
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Authentication required");

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile || adminProfile.company_id !== input.companyId) {
    throw new Error("Appointment is outside the current company");
  }

  const service = createServiceClient();
  const { data: rep, error: repError } = await service
    .from("reps")
    .select("id")
    .eq("id", input.repId)
    .eq("company_id", input.companyId)
    .eq("is_active", true)
    .maybeSingle();
  if (repError || !rep) throw new Error("Active representative not found");

  const { data: appointment, error: appointmentError } = await service
    .from("appointments")
    .update({ rep_id: input.repId, updated_at: new Date().toISOString() })
    .eq("id", input.appointmentId)
    .eq("company_id", input.companyId)
    .in("status", ["scheduled", "confirmed"])
    .select("id, lead_id")
    .single();
  if (appointmentError || !appointment) throw new Error("Appointment not found");

  const correlationId = crypto.randomUUID();
  const event = createEventEnvelope({
    name: "appointments/rep.assigned",
    correlationId,
    leadId: appointment.lead_id,
    data: {
      appointmentId: appointment.id,
      repId: input.repId,
    },
  });
  await new SupabaseOutboxRepository(service).enqueue(event, input.companyId);

  revalidatePath(`/leads/${appointment.lead_id}`);
  return { appointmentId: appointment.id };
}

// -----------------------------------------------------------------------------
// Virtual consultations
// -----------------------------------------------------------------------------

async function requireCrmAccess() {
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_my_access");
  const access = parseMyAccess(data);
  if (!access || !canUseCrm(access)) throw new Error("Manager access required");
  return { supabase, access };
}

const appointmentFormSchema = z.object({ appointmentId: z.uuid() });

/** Form wrapper for the appointments page's assign control. */
export async function assignRepFromForm(formData: FormData) {
  const input = appointmentFormSchema
    .extend({ repId: z.uuid() })
    .parse({ appointmentId: formData.get("appointmentId"), repId: formData.get("repId") });
  const { access } = await requireCrmAccess();
  await assignAppointmentRep(access.companyId, input.appointmentId, input.repId);
  revalidatePath("/appointments");
}

/** Re-runs the Google Calendar sync for one consultation. */
export async function retryCalendarSync(formData: FormData) {
  const { appointmentId } = appointmentFormSchema.parse({ appointmentId: formData.get("appointmentId") });
  const { supabase, access } = await requireCrmAccess();
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("meeting_type", "virtual")
    .maybeSingle();
  if (!appointment) throw new Error("Appointment not found");
  await inngest.send({
    name: "appointments/virtual.sync_requested",
    data: { companyId: access.companyId, data: { appointmentId } },
  });
  revalidatePath("/appointments");
}

/** Cancels on the homeowner's behalf; the calendar sync tells Google and the email tells them. */
export async function cancelVirtualConsultation(formData: FormData) {
  const { appointmentId } = appointmentFormSchema.parse({ appointmentId: formData.get("appointmentId") });
  const { access } = await requireCrmAccess();
  const service = createServiceClient();
  const { data, error } = await service.rpc("staff_cancel_virtual_consultation", {
    p_company_id: access.companyId,
    p_appointment_id: appointmentId,
  });
  const row = data?.[0];
  if (error || !row) throw new Error("Failed to cancel the consultation");
  if (row.outcome === "cancelled" && row.event) {
    await enqueueAndPublishEvent({
      repository: new SupabaseOutboxRepository(service),
      event: eventEnvelopeSchema.parse(row.event),
      companyId: access.companyId,
      eventAlreadyPersisted: true,
      send: (outbound) => inngest.send(outbound),
    });
  }
  revalidatePath("/appointments");
}

const outcomeSchema = appointmentFormSchema.extend({ outcome: z.enum(["completed", "no_show"]) });

/** Records whether a past consultation was held. */
export async function recordConsultationOutcome(formData: FormData) {
  const input = outcomeSchema.parse({
    appointmentId: formData.get("appointmentId"),
    outcome: formData.get("outcome"),
  });
  const { supabase } = await requireCrmAccess();
  const { data, error } = await supabase
    .from("appointments")
    .update({ status: input.outcome })
    .eq("id", input.appointmentId)
    .in("status", ["scheduled", "confirmed"])
    .lt("scheduled_at", new Date().toISOString())
    .select("lead_id");
  if (error || !data?.length) throw new Error("Failed to record the outcome");
  revalidatePath("/appointments");
  revalidatePath(`/leads/${data[0].lead_id}`);
}

/** Issues (or reuses) the lead's booking link for staff to send by text or email. */
export async function createLeadBookingLink(leadId: string) {
  const parsedLeadId = z.uuid().parse(leadId);
  const { supabase, access } = await requireCrmAccess();
  const { data: lead } = await supabase.from("leads").select("id").eq("id", parsedLeadId).maybeSingle();
  if (!lead) throw new Error("Lead not found");
  const configuration = resolveBookingConfiguration();
  if (!configuration) return { ok: false as const, reason: "Online booking is not set up yet." };
  const service = createServiceClient();
  if (!(await isVirtualBookingAvailable(service, access.companyId))) {
    return { ok: false as const, reason: "Turn on video booking in Settings first." };
  }
  const { url, expiresAt } = await ensureBookingUrl({
    client: service,
    configuration,
    companyId: access.companyId,
    leadId: parsedLeadId,
    source: "staff",
    createdBy: access.userId,
  });
  return { ok: true as const, url, expiresAt };
}
