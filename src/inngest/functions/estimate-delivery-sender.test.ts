import { describe, expect, it, vi } from "vitest";
import {
  dispatchEstimateDelivery,
  sendQueuedEstimateDeliveries,
  type EstimateDelivery,
  type EstimateDeliveryRepository,
} from "./estimate-delivery-sender";

const delivery: EstimateDelivery = {
  id: "delivery-1",
  estimateId: "estimate-1",
  leadId: "lead-1",
  channel: "sms",
  destination: "+15555550100",
  subject: null,
  body: "Your preliminary estimate is ready.",
};

describe("estimate delivery sender", () => {
  it("does not call a provider until its webhook is configured", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(dispatchEstimateDelivery(delivery, {}, fetcher)).resolves.toEqual({
      outcome: "not_configured",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts only the consented delivery payload and marks success", async () => {
    const sent: string[] = [];
    const failed: string[] = [];
    const repository: EstimateDeliveryRepository = {
      listQueued: async () => [delivery],
      markSent: async (id) => { sent.push(id); },
      markFailed: async (id) => { failed.push(id); },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const results = await sendQueuedEstimateDeliveries(
      repository,
      { smsWebhookUrl: "https://delivery.example/sms", sharedSecret: "secret" },
      fetcher,
    );
    expect(results).toEqual([{ id: "delivery-1", channel: "sms", outcome: "sent" }]);
    expect(sent).toEqual(["delivery-1"]);
    expect(failed).toEqual([]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://delivery.example/sms",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });

  it("records a sanitized provider failure", async () => {
    const failures: string[] = [];
    const repository: EstimateDeliveryRepository = {
      listQueued: async () => [delivery],
      markSent: async () => undefined,
      markFailed: async (_id, reason) => { failures.push(reason); },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const results = await sendQueuedEstimateDeliveries(
      repository,
      { smsWebhookUrl: "https://delivery.example/sms" },
      fetcher,
    );
    expect(results[0]?.outcome).toBe("failed");
    expect(failures).toEqual(["Delivery provider returned HTTP 503"]);
  });
});
