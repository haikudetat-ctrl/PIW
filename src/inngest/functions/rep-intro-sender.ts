import "server-only";
import { appointmentRepAssigned, inngest } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";
import {
  calculateRepIntroSendAt,
  composeRepIntroMessage,
  type RepIntroContext,
} from "@/modules/appointments/rep-intro";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";

export interface RepIntroSenderRepository {
  loadContext(appointmentId: string, repId: string): Promise<RepIntroContext>;
  queueIntro(input: {
    context: RepIntroContext;
    subject: string;
    body: string;
    scheduledFor: string;
  }): Promise<void>;
  writeAudit(input: {
    context: RepIntroContext;
    eventId: string;
    correlationId: string;
    scheduledFor: string;
  }): Promise<void>;
}

export type RepIntroPlan = {
  context: RepIntroContext;
  scheduledFor: string;
};

export async function buildRepIntroPlan(
  input: { appointmentId: string; repId: string },
  repository: RepIntroSenderRepository,
  now: Date,
): Promise<RepIntroPlan> {
  const context = await repository.loadContext(input.appointmentId, input.repId);
  return {
    context,
    scheduledFor: calculateRepIntroSendAt(context.scheduledAt, now).toISOString(),
  };
}

export async function queueRepIntroPlan(
  plan: RepIntroPlan,
  event: { id: string; correlationId: string },
  repository: RepIntroSenderRepository,
) {
  const message = composeRepIntroMessage(plan.context);
  await repository.queueIntro({
    context: plan.context,
    subject: message.subject,
    body: message.body,
    scheduledFor: plan.scheduledFor,
  });
  await repository.writeAudit({
    context: plan.context,
    eventId: event.id,
    correlationId: event.correlationId,
    scheduledFor: plan.scheduledFor,
  });
}

export class SupabaseRepIntroSenderRepository implements RepIntroSenderRepository {
  constructor(private readonly client = createServiceClient()) {}

  async loadContext(appointmentId: string, repId: string): Promise<RepIntroContext> {
    const { data: appointment, error: appointmentError } = await this.client
      .from("appointments")
      .select("id, company_id, lead_id, rep_id, scheduled_at")
      .eq("id", appointmentId)
      .eq("rep_id", repId)
      .in("status", ["scheduled", "confirmed"])
      .single();
    if (appointmentError || !appointment) {
      throw new Error("Failed to load assigned appointment");
    }

    const [{ data: lead, error: leadError }, { data: rep, error: repError }] =
      await Promise.all([
        this.client.from("leads").select("name").eq("id", appointment.lead_id).single(),
        this.client
          .from("reps")
          .select("name, bio, credentials, community_connection")
          .eq("id", repId)
          .eq("company_id", appointment.company_id)
          .single(),
      ]);
    if (leadError || !lead || repError || !rep) {
      throw new Error("Failed to load representative intro context");
    }

    return {
      appointmentId: appointment.id,
      companyId: appointment.company_id,
      repId,
      scheduledAt: appointment.scheduled_at,
      customerName: lead.name,
      repName: rep.name,
      repBio: rep.bio,
      repCredentials: rep.credentials,
      repCommunityConnection: rep.community_connection,
    };
  }

  async queueIntro(input: {
    context: RepIntroContext;
    subject: string;
    body: string;
    scheduledFor: string;
  }) {
    const { error } = await this.client.from("appointment_rep_intros").upsert(
      {
        company_id: input.context.companyId,
        appointment_id: input.context.appointmentId,
        rep_id: input.context.repId,
        composed_subject: input.subject,
        composed_body: input.body,
        status: "queued",
        scheduled_for: input.scheduledFor,
        sent_at: null,
      },
      { onConflict: "appointment_id" },
    );
    if (error) throw new Error("Failed to queue representative intro");
  }

  async writeAudit(input: {
    context: RepIntroContext;
    eventId: string;
    correlationId: string;
    scheduledFor: string;
  }) {
    await writeAuditEntry(
      {
        companyId: input.context.companyId,
        action: "appointment.rep_intro_queued",
        entityType: "appointment",
        entityId: input.context.appointmentId,
        correlationId: input.correlationId,
        metadata: {
          eventId: input.eventId,
          repId: input.context.repId,
          scheduledFor: input.scheduledFor,
        },
      },
      this.client,
    );
  }
}

export const repIntroSender = inngest.createFunction(
  { id: "rep-intro-sender", triggers: { event: appointmentRepAssigned } },
  async ({ event, step }) => {
    const repository = new SupabaseRepIntroSenderRepository();
    const plan = await step.run("load-context", () =>
      buildRepIntroPlan(
        {
          appointmentId: event.data.data.appointmentId,
          repId: event.data.data.repId,
        },
        repository,
        new Date(),
      ),
    );

    await step.sleepUntil("wait-for-send-window", new Date(plan.scheduledFor));

    await step.run("compose-and-queue-intro", () =>
      repository.queueIntro({
        context: plan.context,
        ...composeRepIntroMessage(plan.context),
        scheduledFor: plan.scheduledFor,
      }),
    );

    await step.run("write-audit-entry", () =>
      repository.writeAudit({
        context: plan.context,
        eventId: event.data.id,
        correlationId: event.data.correlationId,
        scheduledFor: plan.scheduledFor,
      }),
    );

    return { ok: true, appointmentId: plan.context.appointmentId };
  },
);
