import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import { createEventEnvelope } from "@/domain/events";
import { inngest, leadSubmitted } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";
import { enqueueAndPublishEvent } from "@/modules/events/enqueue-and-publish-event";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import type {Database} from "@/lib/database.types";

export type WorkerRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "review_required"
  | "failed";

export type WorkerRunRecord = { id: string; status: WorkerRunStatus };

export interface CrmWriterRepository {
  upsertWorkerRunQueued(input: {
    pipelineRunId: string;
    idempotencyKey: string;
  }): Promise<WorkerRunRecord>;
  markWorkerRunCompleted(workerRunId: string): Promise<void>;
  recordInitialStageHistory(leadId: string): Promise<void>;
  createLeadSubmittedNotification(input: {
    leadId: string;
    correlationId: string;
  }): Promise<void>;
  hasEstimateProcessingConsent(leadId: string): Promise<boolean>;
  ensureImmediateEstimateCallTask(leadId: string): Promise<void>;
  publishAddressValidationRequested(input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    correlationId: string;
    submittedAddress: string;
    googlePlaceId?: string;
  }): Promise<void>;
}

type LeadSubmittedEventData = {
  id: string;
  pipelineRunId: string;
  correlationId: string;
  leadId: string;
  propertyId: string;
  submittedAddress: string;
  googlePlaceId?: string;
};

export async function writeCrmProjection(
  event: LeadSubmittedEventData,
  repository: CrmWriterRepository,
) {
  const idempotencyKey = `crm-writer:${event.pipelineRunId}`;
  const workerRun = await repository.upsertWorkerRunQueued({
    pipelineRunId: event.pipelineRunId,
    idempotencyKey,
  });

  await repository.recordInitialStageHistory(event.leadId);
  await repository.createLeadSubmittedNotification({
    leadId: event.leadId,
    correlationId: event.correlationId,
  });
  if (await repository.hasEstimateProcessingConsent(event.leadId)) {
    await repository.ensureImmediateEstimateCallTask(event.leadId);
    await repository.publishAddressValidationRequested({
      leadId: event.leadId,
      propertyId: event.propertyId,
      pipelineRunId: event.pipelineRunId,
      correlationId: event.correlationId,
      submittedAddress: event.submittedAddress,
      googlePlaceId: event.googlePlaceId,
    });
  }

  if (workerRun.status !== "completed") {
    await repository.markWorkerRunCompleted(workerRun.id);
  }

  return { workerRunId: workerRun.id, status: "completed" as const };
}

export class SupabaseCrmWriterRepository implements CrmWriterRepository {
  constructor(
    private readonly client: SupabaseClient<Database> = createServiceClient(),
    private readonly send: (outbound: Parameters<typeof inngest.send>[0]) => ReturnType<typeof inngest.send> =
      (outbound) => inngest.send(outbound),
  ) {}

  async upsertWorkerRunQueued(input: { pipelineRunId: string; idempotencyKey: string }) {
    const { data: inserted, error: insertError } = await this.client
      .from("worker_runs")
      .insert({
        pipeline_run_id: input.pipelineRunId,
        worker_type: "crm_writer",
        worker_version: 1,
        idempotency_key: input.idempotencyKey,
        status: "queued",
        started_at: new Date().toISOString(),
      })
      .select("id, status")
      .single();

    if (!insertError && inserted) return { id: inserted.id, status: inserted.status };

    const { data: existing, error: selectError } = await this.client
      .from("worker_runs")
      .select("id, status")
      .eq("idempotency_key", input.idempotencyKey)
      .single();

    if (selectError || !existing) throw new Error("Failed to record CRM writer start");
    return { id: existing.id, status: existing.status };
  }

  async markWorkerRunCompleted(workerRunId: string) {
    await this.client
      .from("worker_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", workerRunId)
      .neq("status", "completed");
  }

  async recordInitialStageHistory(leadId: string) {
    const { data: lead, error: leadError } = await this.client
      .from("leads")
      .select("company_id")
      .eq("id", leadId)
      .single();
    if (leadError || !lead) throw new Error("Failed to load lead for stage history");

    const { error: insertError } = await this.client.from("lead_stage_history").insert({
      company_id: lead.company_id,
      lead_id: leadId,
      from_stage: null,
      to_stage: "new",
      changed_by: null,
    });
    // 23505 = unique_violation: the initial-stage row already exists.
    if (insertError && insertError.code !== "23505") {
      throw new Error("Failed to record initial lead stage");
    }
  }

  async createLeadSubmittedNotification(input: { leadId: string; correlationId: string }) {
    const { data: lead, error: leadError } = await this.client
      .from("leads")
      .select("company_id, name")
      .eq("id", input.leadId)
      .single();
    if (leadError || !lead) throw new Error("Failed to load lead for notification");

    const { error: insertError } = await this.client.from("notifications").insert({
      company_id: lead.company_id,
      lead_id: input.leadId,
      type: "lead_submitted",
      title: `New lead: ${lead.name}`,
      body: "A new lead was submitted and is ready for review.",
      correlation_id: input.correlationId,
    });
    if (insertError && insertError.code !== "23505") {
      throw new Error("Failed to create lead-submitted notification");
    }
  }

  async hasEstimateProcessingConsent(leadId: string) {
    const { data, error } = await this.client
      .from("lead_consents")
      .select("id")
      .eq("lead_id", leadId)
      .eq("consent_type", "estimate_processing")
      .eq("granted", true)
      .maybeSingle();
    if (error) throw new Error("Failed to verify estimate-processing consent");
    return data !== null;
  }

  async ensureImmediateEstimateCallTask(leadId: string) {
    const title = "Call new roof-estimate lead now";
    const { data: lead, error: leadError } = await this.client
      .from("leads")
      .select("company_id, name, phone")
      .eq("id", leadId)
      .single();
    if (leadError || !lead) throw new Error("Failed to load estimate lead for call task");
    const { data: existing, error: existingError } = await this.client
      .from("tasks")
      .select("id")
      .eq("lead_id", leadId)
      .eq("title", title)
      .maybeSingle();
    if (existingError) throw new Error("Failed to check estimate call task");
    if (existing) return;
    const { error } = await this.client.from("tasks").insert({
      company_id: lead.company_id,
      lead_id: leadId,
      title,
      description: `Call ${lead.name} at ${lead.phone} while their estimate is processing.`,
      due_at: new Date().toISOString(),
    });
    if (error && error.code !== "23505") throw new Error("Failed to create estimate call task");
  }

  async publishAddressValidationRequested(input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    correlationId: string;
    submittedAddress: string;
    googlePlaceId?: string;
  }) {
    const { data: lead, error } = await this.client
      .from("leads")
      .select("company_id")
      .eq("id", input.leadId)
      .single();
    if (error || !lead) {
      throw new Error("Failed to load lead for address validation trigger");
    }

    const event = createEventEnvelope({
      name: "property/address.validation_requested",
      correlationId: input.correlationId,
      pipelineRunId: input.pipelineRunId,
      leadId: input.leadId,
      propertyId: input.propertyId,
      data: {
        leadId: input.leadId,
        propertyId: input.propertyId,
        submittedAddress: input.submittedAddress,
        googlePlaceId: input.googlePlaceId,
        attempt: 1,
      },
    });

    await enqueueAndPublishEvent({
      repository: new SupabaseOutboxRepository(this.client),
      event,
      companyId: lead.company_id,
      send: this.send,
    });
  }
}

export const crmWriter = inngest.createFunction(
  { id: "crm-writer", triggers: { event: leadSubmitted } },
  async ({ event, step }) => {
    const repository = new SupabaseCrmWriterRepository();

    const workerRun = await step.run("record-worker-start", () =>
      repository.upsertWorkerRunQueued({
        pipelineRunId: event.data.pipelineRunId,
        idempotencyKey: `crm-writer:${event.data.pipelineRunId}`,
      }),
    );

    await step.run("record-initial-stage", () =>
      repository.recordInitialStageHistory(event.data.leadId),
    );

    await step.run("create-lead-notification", () =>
      repository.createLeadSubmittedNotification({
        leadId: event.data.leadId,
        correlationId: event.data.correlationId,
      }),
    );

    const hasEstimateConsent = await step.run("verify-estimate-consent", () =>
      repository.hasEstimateProcessingConsent(event.data.leadId),
    );

    if (hasEstimateConsent) {
      await step.run("create-immediate-call-task", () =>
        repository.ensureImmediateEstimateCallTask(event.data.leadId),
      );
      await step.run("publish-address-validation-requested", () =>
        repository.publishAddressValidationRequested({
          leadId: event.data.leadId,
          propertyId: event.data.propertyId,
          pipelineRunId: event.data.pipelineRunId,
          correlationId: event.data.correlationId,
          submittedAddress: event.data.data.submittedAddress,
          googlePlaceId: event.data.data.googlePlaceId,
        }),
      );
    }

    await step.run("record-worker-completion", async () => {
      if (workerRun.status !== "completed") {
        await repository.markWorkerRunCompleted(workerRun.id);
      }
    });

    await step.run("write-audit-entry", async () => {
      // Only the run that actually completes the worker writes the audit
      // entry — a replayed/duplicate delivery finds `workerRun` already
      // `completed` (from `record-worker-start`'s select-existing fallback)
      // and skips this, since `writeAuditEntry` has no dedup of its own.
      if (workerRun.status === "completed") return;

      const client = createServiceClient();
      const { data: lead } = await client
        .from("leads")
        .select("company_id")
        .eq("id", event.data.leadId)
        .single();
      if (lead) {
        await writeAuditEntry(
          {
            companyId: lead.company_id,
            action: "crm.lead_submitted_processed",
            entityType: "lead",
            entityId: event.data.leadId,
            correlationId: event.data.correlationId,
          },
          client,
        );
      }
    });

    return { ok: true, eventId: event.data.id };
  },
);
