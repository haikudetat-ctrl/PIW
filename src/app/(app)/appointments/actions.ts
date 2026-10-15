"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createEventEnvelope } from "@/domain/events";
import { canUseCrm, parseMyAccess, type MyAccess } from "@/lib/auth/access";
import type { Database } from "@/lib/database.types";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  APPOINTMENT_OUTCOMES,
  companyLocalToIso,
  isMissed,
  isOpenAppointment,
  isRebookTaskTitle,
  rebookTask,
  stageAfterBooking,
  stageAfterMissed,
  type AppointmentOutcome,
} from "@/modules/appointments/booking";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import type { LeadStage } from "@/modules/leads/change-lead-stage";

export type AppointmentFormState = { ok: true } | { ok: false; message: string } | null;

const blankToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

const bookingInputSchema = z.object({
  scheduledAt: z.string().min(1),
  durationMinutes: z.preprocess(blankToUndefined, z.coerce.number().int().min(15).max(480).optional()),
  repId: z.preprocess(blankToUndefined, z.uuid().optional()),
  notes: z.preprocess(blankToUndefined, z.string().trim().max(2000).optional()),
});

type Service = SupabaseClient<Database>;

async function loadAccess(): Promise<MyAccess | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const access = parseMyAccess((await supabase.rpc("get_my_access")).data);
  return access && canUseCrm(access) ? access : null;
}

async function moveStage(
  service: Service,
  access: MyAccess,
  leadId: string,
  toStage: LeadStage,
  note: string,
) {
  const { data, error } = await service.rpc("change_lead_stage", {
    p_company_id: access.companyId,
    p_lead_id: leadId,
    p_to_stage: toStage,
    p_changed_by: access.userId,
    p_note: note,
  });
  if (error || !data?.[0]) throw new Error("Failed to change lead stage");
  await writeAuditEntry(
    {
      companyId: access.companyId,
      actorId: access.userId,
      action: "lead.stage_changed",
      entityType: "lead",
      entityId: leadId,
      metadata: { fromStage: data[0].from_stage, toStage, reason: note },
    },
    service,
  );
}

function revalidateLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/pipeline");
  revalidatePath("/");
}

export async function bookAppointment(
  leadId: string,
  _previous: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const access = await loadAccess();
  if (!access) return { ok: false, message: "You can't book appointments in Rake." };

  const parsed = bookingInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the appointment details and try again." };
  const input = parsed.data;
  const scheduledAt = companyLocalToIso(input.scheduledAt);
  if (!scheduledAt) return { ok: false, message: "Pick a valid date and time." };

  const service = createServiceClient();
  const { data: lead } = await service
    .from("leads")
    .select("id, stage")
    .eq("id", z.uuid().parse(leadId))
    .eq("company_id", access.companyId)
    .maybeSingle();
  if (!lead) return { ok: false, message: "Lead not found." };

  if (input.repId) {
    const { data: rep } = await service
      .from("reps")
      .select("id")
      .eq("id", input.repId)
      .eq("company_id", access.companyId)
      .eq("is_active", true)
      .maybeSingle();
    if (!rep) return { ok: false, message: "That rep is no longer active." };
  }

  const { data: appointment, error } = await service
    .from("appointments")
    .insert({
      company_id: access.companyId,
      lead_id: lead.id,
      rep_id: input.repId ?? null,
      scheduled_at: scheduledAt,
      duration_minutes: input.durationMinutes ?? null,
      notes: input.notes ?? null,
      status: "scheduled",
      created_by: access.userId,
    })
    .select("id")
    .single();
  if (error || !appointment) return { ok: false, message: "The appointment couldn't be saved." };

  const nextStage = stageAfterBooking(lead.stage);
  if (nextStage) await moveStage(service, access, lead.id, nextStage, "Inspection booked");

  // A booking answers any open rebook task on the lead.
  const { data: openTasks } = await service
    .from("tasks")
    .select("id, title")
    .eq("company_id", access.companyId)
    .eq("lead_id", lead.id)
    .eq("status", "open");
  const rebookIds = (openTasks ?? []).filter((task) => isRebookTaskTitle(task.title)).map((task) => task.id);
  if (rebookIds.length > 0) {
    await service
      .from("tasks")
      .update({ status: "complete", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", rebookIds);
  }

  if (input.repId) {
    const event = createEventEnvelope({
      name: "appointments/rep.assigned",
      correlationId: crypto.randomUUID(),
      leadId: lead.id,
      data: { appointmentId: appointment.id, repId: input.repId },
    });
    await new SupabaseOutboxRepository(service).enqueue(event, access.companyId);
  }

  await writeAuditEntry(
    {
      companyId: access.companyId,
      actorId: access.userId,
      action: "appointment.booked",
      entityType: "appointment",
      entityId: appointment.id,
      metadata: { leadId: lead.id, scheduledAt, repId: input.repId ?? null },
    },
    service,
  );

  revalidateLead(lead.id);
  return { ok: true };
}

export async function setAppointmentStatus(leadId: string, appointmentId: string, status: AppointmentOutcome) {
  const access = await loadAccess();
  if (!access) throw new Error("Not allowed");
  const outcome = z.enum(APPOINTMENT_OUTCOMES).parse(status);

  const service = createServiceClient();
  const { data: appointment } = await service
    .from("appointments")
    .select("id, lead_id, status, scheduled_at, leads(name, phone, stage)")
    .eq("id", z.uuid().parse(appointmentId))
    .eq("lead_id", z.uuid().parse(leadId))
    .eq("company_id", access.companyId)
    .maybeSingle();
  if (!appointment) throw new Error("Appointment not found");
  if (!isOpenAppointment(appointment.status)) return;

  const { error } = await service
    .from("appointments")
    .update({ status: outcome, updated_at: new Date().toISOString() })
    .eq("id", appointment.id)
    .in("status", ["scheduled", "confirmed"]);
  if (error) throw new Error("Failed to update appointment");

  const lead = Array.isArray(appointment.leads) ? appointment.leads[0] : appointment.leads;
  if (isMissed(outcome) && lead) {
    const task = rebookTask({
      appointmentId: appointment.id,
      status: outcome as "no_show" | "cancelled",
      scheduledAt: appointment.scheduled_at,
      leadName: lead.name,
      leadPhone: lead.phone,
    });
    const { error: taskError } = await service.from("tasks").insert({
      company_id: access.companyId,
      lead_id: appointment.lead_id,
      title: task.title,
      description: task.description,
      due_at: new Date().toISOString(),
      source_key: task.sourceKey,
      created_by: access.userId,
    });
    // 23505: this appointment's rebook task already exists.
    if (taskError && taskError.code !== "23505") throw new Error("Failed to create rebook task");

    const nextStage = stageAfterMissed(lead.stage);
    if (nextStage) {
      await moveStage(
        service,
        access,
        appointment.lead_id,
        nextStage,
        outcome === "no_show" ? "Inspection no-show" : "Inspection cancelled",
      );
    }
  }

  await writeAuditEntry(
    {
      companyId: access.companyId,
      actorId: access.userId,
      action: "appointment.status_changed",
      entityType: "appointment",
      entityId: appointment.id,
      metadata: { leadId: appointment.lead_id, fromStatus: appointment.status, toStatus: outcome },
    },
    service,
  );

  revalidateLead(appointment.lead_id);
}
