import {describe, expect, test, vi} from "vitest";
import {sendLeadDistributionDelivery} from "./lead-distribution-sender";
import type {MetaDistributionLead} from "@/modules/leads/meta-lead-distribution";

const lead: MetaDistributionLead = {
  id: "11111111-1111-4111-8111-111111111111", name: "Jordan Rivera",
  phone: "+12015550100", email: "jordan@example.com",
  submittedAddress: "123 Main Street, Newark, NJ 07102",
  sourceSystem: "canonical-roof-assessment", sourceSubmittedAt: "2026-09-03T12:00:00.000Z",
  clientIpAddress: null, clientUserAgent: null, trustedFormUrl: null,
};

describe("lead distribution sender", () => {
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
