"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createEventEnvelope } from "@/domain/events";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";

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
