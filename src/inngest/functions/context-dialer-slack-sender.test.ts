import { describe, expect, it, vi } from "vitest";
import {
  buildContextDialerSlackPayload,
  sendQueuedContextDialers,
  type ContextDialerDelivery,
  type ContextDialerSlackRepository,
  type ContextDialerSummary,
} from "./context-dialer-slack-sender";

const delivery: ContextDialerDelivery = {
  id: "delivery-1",
  companyId: "company-1",
  pipelineRunId: "pipeline-1",
  leadId: "lead-1",
  estimateId: "estimate-1",
  attemptCount: 0,
};

const summary: ContextDialerSummary = {
  leadId: "lead-1",
  name: "Alex & Casey",
  phone: "+16095550100",
  email: "alex@example.com",
  canonicalAddress: "12 Birch Street, Trenton, NJ 08608",
  source: "Meta Roofing",
  estimateStatus: "ready",
  rangeLowCents: 1_250_000,
  rangeHighCents: 1_875_000,
  roofSquares: 25,
};

function repository() {
  return {
    listQueued: vi.fn(async () => [delivery]),
    loadSummary: vi.fn(async () => summary),
    markSent: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  } satisfies ContextDialerSlackRepository;
}

describe("Context Dialer Slack sender", () => {
  it("builds a concise lead card with a stable Context Dialer link", () => {
    const payload = buildContextDialerSlackPayload(summary, "https://piw.example.com");
    expect(payload.text).toContain("Alex & Casey");
    expect(JSON.stringify(payload.blocks)).toContain("$12,500–$18,750");
    expect(JSON.stringify(payload.blocks)).toContain(
      "https://piw.example.com/leads/lead-1/dialer",
    );
    expect(JSON.stringify(payload.blocks)).toContain("Alex &amp; Casey");
  });

  it("posts once and marks the durable delivery sent", async () => {
    const repo = repository();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    await expect(
      sendQueuedContextDialers(
        repo,
        {
          webhookUrl: "https://hooks.slack.test/services/context",
          baseUrl: "https://piw.example.com",
        },
        fetcher,
      ),
    ).resolves.toEqual([{ id: "delivery-1", outcome: "sent" }]);
    expect(repo.markSent).toHaveBeenCalledWith(delivery);
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("terminalizes missing configuration instead of retrying forever", async () => {
    const repo = repository();
    await expect(sendQueuedContextDialers(repo, {})).resolves.toEqual([
      { id: "delivery-1", outcome: "not_configured" },
    ]);
    expect(repo.loadSummary).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith(
      delivery,
      "Slack Context Dialer webhook and base URL are not configured",
    );
  });

  it("contains a malformed optional webhook to Slack delivery", async () => {
    const repo = repository();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to parse URL"));

    await expect(
      sendQueuedContextDialers(
        repo,
        {
          webhookUrl: "not-a-valid-webhook-url",
          baseUrl: "https://piw.example.com",
        },
        fetcher,
      ),
    ).resolves.toEqual([{ id: "delivery-1", outcome: "failed" }]);
    expect(repo.markFailed).toHaveBeenCalledWith(delivery, "Failed to parse URL");
    expect(repo.markSent).not.toHaveBeenCalled();
  });
});
