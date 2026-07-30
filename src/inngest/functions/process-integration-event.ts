import "server-only";
import { inngest, integrationEventReceived } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";

export interface IntegrationEventRepository {
  markProcessed(integrationEventId: string): Promise<void>;
}

type IntegrationEventReceivedEvent = {
  integrationEventId: string;
};

// Stage 1 stub: durably records that the event was seen and closes the
// loop. Real vendor-payload mapping into submit_lead_intake_from_source
// lands once LeadConduit/CallTools access is available and their payload
// shapes are known (All Season plan §7).
export async function processIntegrationEventData(
  event: IntegrationEventReceivedEvent,
  repository: IntegrationEventRepository,
) {
  await repository.markProcessed(event.integrationEventId);
  return { ok: true, integrationEventId: event.integrationEventId };
}

class SupabaseIntegrationEventRepository implements IntegrationEventRepository {
  private readonly client = createServiceClient();

  async markProcessed(integrationEventId: string): Promise<void> {
    const { error } = await this.client.rpc("mark_integration_event_processed", {
      p_event_id: integrationEventId,
      p_outcome: "processed",
    });
    if (error) throw new Error("Failed to mark integration event processed");
  }
}

export const processIntegrationEvent = inngest.createFunction(
  { id: "process-integration-event", triggers: { event: integrationEventReceived } },
  async ({ event, step }) => {
    const repository = new SupabaseIntegrationEventRepository();
    const integrationEventId = event.data.data.integrationEventId;

    await step.run("mark-integration-event-processed", () =>
      repository.markProcessed(integrationEventId),
    );

    return { ok: true, integrationEventId };
  },
);
