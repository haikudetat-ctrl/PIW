import "server-only";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";

export type EstimateDelivery = {
  id: string;
  estimateId: string;
  leadId: string;
  channel: "sms" | "email";
  destination: string;
  subject: string | null;
  body: string;
};

export interface EstimateDeliveryRepository {
  listQueued(limit: number): Promise<EstimateDelivery[]>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}

type DeliveryConfig = {
  smsWebhookUrl?: string;
  emailWebhookUrl?: string;
  sharedSecret?: string;
};

export async function dispatchEstimateDelivery(
  delivery: EstimateDelivery,
  config: DeliveryConfig,
  fetcher: typeof fetch = fetch,
) {
  const endpoint =
    delivery.channel === "sms" ? config.smsWebhookUrl : config.emailWebhookUrl;
  if (!endpoint) return { outcome: "not_configured" as const };

  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.sharedSecret
        ? { authorization: `Bearer ${config.sharedSecret}` }
        : {}),
    },
    body: JSON.stringify({
      deliveryId: delivery.id,
      estimateId: delivery.estimateId,
      leadId: delivery.leadId,
      channel: delivery.channel,
      destination: delivery.destination,
      subject: delivery.subject,
      body: delivery.body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Delivery provider returned HTTP ${response.status}`);
  }
  return { outcome: "sent" as const };
}

export async function sendQueuedEstimateDeliveries(
  repository: EstimateDeliveryRepository,
  config: DeliveryConfig,
  fetcher: typeof fetch = fetch,
) {
  const deliveries = await repository.listQueued(25);
  const results = [];
  for (const delivery of deliveries) {
    try {
      const result = await dispatchEstimateDelivery(delivery, config, fetcher);
      if (result.outcome === "sent") await repository.markSent(delivery.id);
      results.push({ id: delivery.id, channel: delivery.channel, ...result });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Delivery failed";
      await repository.markFailed(delivery.id, reason.slice(0, 500));
      results.push({ id: delivery.id, channel: delivery.channel, outcome: "failed" as const });
    }
  }
  return results;
}

class SupabaseEstimateDeliveryRepository implements EstimateDeliveryRepository {
  private readonly client = createServiceClient();

  async listQueued(limit: number) {
    const { data, error } = await this.client
      .from("estimate_deliveries")
      .select("id, estimate_id, lead_id, channel, destination, composed_subject, composed_body")
      .eq("status", "queued")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(limit);
    if (error) throw new Error("Failed to load queued estimate deliveries");
    return (data ?? []).flatMap((row): EstimateDelivery[] =>
      row.channel === "sms" || row.channel === "email"
        ? [{
            id: row.id,
            estimateId: row.estimate_id,
            leadId: row.lead_id,
            channel: row.channel,
            destination: row.destination,
            subject: row.composed_subject,
            body: row.composed_body,
          }]
        : [],
    );
  }

  async markSent(id: string) {
    const now = new Date().toISOString();
    const { error } = await this.client
      .from("estimate_deliveries")
      .update({ status: "sent", sent_at: now, failure_reason: null, updated_at: now })
      .eq("id", id)
      .eq("status", "queued");
    if (error) throw new Error("Failed to mark estimate delivery sent");
  }

  async markFailed(id: string, reason: string) {
    const { error } = await this.client
      .from("estimate_deliveries")
      .update({ status: "failed", failure_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "queued");
    if (error) throw new Error("Failed to mark estimate delivery failed");
  }
}

export const estimateDeliverySender = inngest.createFunction(
  { id: "estimate-delivery-sender", triggers: { cron: "* * * * *" } },
  async ({ step }) =>
    step.run("send-queued-estimates", async () => {
      const environment = parseServerEnv(process.env);
      return sendQueuedEstimateDeliveries(
        new SupabaseEstimateDeliveryRepository(),
        {
          smsWebhookUrl: environment.ESTIMATE_SMS_WEBHOOK_URL,
          emailWebhookUrl: environment.ESTIMATE_EMAIL_WEBHOOK_URL,
          sharedSecret: environment.ESTIMATE_DELIVERY_SHARED_SECRET,
        },
      );
    }),
);
