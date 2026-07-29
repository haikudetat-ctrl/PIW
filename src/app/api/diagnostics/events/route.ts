import { NextResponse } from "next/server";
import { createEventEnvelope } from "@/domain/events";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";

type CurrentAdmin = { id: string; companyId: string };

export type DiagnosticsDependencies = {
  getCurrentAdmin: () => Promise<CurrentAdmin | null>;
  enqueueDiagnosticEvent: (input: {
    companyId: string;
    requestedBy: string;
    pipelineRunId: string;
    correlationId: string;
  }) => Promise<{ eventId: string }>;
  recordAuditEntry: (input: {
    companyId: string;
    actorId: string;
    correlationId: string;
    pipelineRunId: string;
  }) => Promise<void>;
};

export async function handleDiagnosticEventRequest(deps: DiagnosticsDependencies) {
  const admin = await deps.getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pipelineRunId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();

  const { eventId } = await deps.enqueueDiagnosticEvent({
    companyId: admin.companyId,
    requestedBy: admin.id,
    pipelineRunId,
    correlationId,
  });

  await deps.recordAuditEntry({
    companyId: admin.companyId,
    actorId: admin.id,
    correlationId,
    pipelineRunId,
  });

  return NextResponse.json({ eventId, pipelineRunId, correlationId }, { status: 202 });
}

async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("id, company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) return null;

  return { id: adminProfile.id, companyId: adminProfile.company_id };
}

export async function POST() {
  return handleDiagnosticEventRequest({
    getCurrentAdmin,
    enqueueDiagnosticEvent: async ({ companyId, requestedBy, pipelineRunId, correlationId }) => {
      const client = createServiceClient();

      const { error: pipelineRunError } = await client.from("pipeline_runs").insert({
        id: pipelineRunId,
        company_id: companyId,
        correlation_id: correlationId,
        pipeline_version: 1,
        status: "received",
      });
      if (pipelineRunError) throw new Error("Failed to record pipeline run");

      const event = createEventEnvelope({
        name: "system/diagnostic.requested",
        correlationId,
        pipelineRunId,
        data: { requestedBy },
      });

      const repository = new SupabaseOutboxRepository(client);
      await repository.enqueue(event, companyId);

      return { eventId: event.id };
    },
    recordAuditEntry: async ({ companyId, actorId, correlationId, pipelineRunId }) => {
      await writeAuditEntry(
        {
          companyId,
          actorId,
          action: "diagnostic.event_requested",
          entityType: "pipeline_run",
          entityId: pipelineRunId,
          correlationId,
        },
        createServiceClient(),
      );
    },
  });
}
