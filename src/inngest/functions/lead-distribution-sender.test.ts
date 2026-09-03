import {describe, expect, test, vi} from "vitest";
import {
  deliveryIdFromLeadDistributionEvent,
  sendLeadDistributionDelivery,
} from "./lead-distribution-sender";
import type {DomainEvent} from "@/domain/events";
import type {MetaDistributionLead} from "@/modules/leads/meta-lead-distribution";

const lead: MetaDistributionLead = {
  id: "11111111-1111-4111-8111-111111111111", name: "Jordan Rivera",
  phone: "+12015550100", email: "jordan@example.com",
  submittedAddress: "123 Main Street, Newark, NJ 07102",
  sourceSystem: "canonical-roof-assessment", sourceSubmittedAt: "2026-09-03T12:00:00.000Z",
  clientIpAddress: null, clientUserAgent: null, trustedFormUrl: null,
};

const requestedEvent: Extract<DomainEvent, {name: "lead/distribution.requested"}> = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "lead/distribution.requested",
  schemaVersion: 1,
  correlationId: "55555555-5555-4555-8555-555555555555",
  leadId: lead.id,
  pipelineRunId: "66666666-6666-4666-8666-666666666666",
  occurredAt: "2026-09-03T12:00:00.000Z",
  idempotencyKey: `lead-distribution:${lead.id}`,
  data: {
    leadId: lead.id,
    sourceLabel: "Meta70",
    activeProspectDeliveryId: "77777777-7777-4777-8777-777777777777",
    internalEmailDeliveryId: "88888888-8888-4888-8888-888888888888",
  },
};

describe("lead distribution sender", () => {
  test.each([
    ["activeprospect", "77777777-7777-4777-8777-777777777777"],
    ["internal_email", "88888888-8888-4888-8888-888888888888"],
  ] as const)("reads the %s delivery ID from the durable event envelope", (destination, expected) => {
    expect(deliveryIdFromLeadDistributionEvent(requestedEvent, destination)).toBe(expected);
  });

  test("claims, sends, and completes one destination", async () => {
    const repository = {
      claim: vi.fn(async () => ({deliveryId: "22222222-2222-4222-8222-222222222222", companyId: "33333333-3333-4333-8333-333333333333", destination: "activeprospect" as const, sourceLabel: "Meta70" as const, attemptCount: 1, lead})),
      complete: vi.fn(async () => "sent" as const),
    };
    const client = {send: vi.fn(async () => ({status: "sent" as const, externalId: "external-1", reason: null}))};
    await expect(sendLeadDistributionDelivery({deliveryId: "22222222-2222-4222-8222-222222222222", companyId: "33333333-3333-4333-8333-333333333333", repository, client}))
      .resolves.toMatchObject({outcome: "sent"});
    expect(client.send).toHaveBeenCalledWith(lead, "Meta70");
    expect(repository.complete).toHaveBeenCalled();
  });

  test("records a retryable failure before throwing for Inngest retry", async () => {
    const repository = {
      claim: vi.fn(async () => ({deliveryId: "22222222-2222-4222-8222-222222222222", companyId: "33333333-3333-4333-8333-333333333333", destination: "internal_email" as const, sourceLabel: "Meta30" as const, attemptCount: 1, lead})),
      complete: vi.fn(async () => "retryable_failed" as const),
    };
    const client = {send: vi.fn(async () => ({status: "retryable_failed" as const, externalId: null, reason: "HTTP 503"}))};
    await expect(sendLeadDistributionDelivery({deliveryId: "22222222-2222-4222-8222-222222222222", companyId: "33333333-3333-4333-8333-333333333333", repository, client}))
      .rejects.toThrow("Lead distribution delivery requires retry");
    expect(repository.complete).toHaveBeenCalled();
  });
});
