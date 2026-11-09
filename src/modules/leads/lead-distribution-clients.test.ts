import {describe, expect, test, vi} from "vitest";
import {
  LeadConduitSubmissionClient,
  ResendLeadNotificationClient,
  resolveWebLeadConduitUrls,
} from "./lead-distribution-clients";
import type {MetaDistributionLead} from "./meta-lead-distribution";

const lead: MetaDistributionLead = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Jordan Rivera",
  phone: "+12015550100",
  email: "jordan@example.com",
  submittedAddress: "123 Main Street, Newark, NJ 07102",
  sourceSystem: "canonical-roof-assessment",
  sourceSubmittedAt: "2026-09-03T12:00:00.000Z",
  clientIpAddress: "203.0.113.10",
  clientUserAgent: "Mozilla/5.0",
  trustedFormUrl: null,
};

describe("lead distribution clients", () => {
  test("submits an exact urlencoded LeadConduit request", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({
      outcome: "success", lead: {id: "123456789012345678901234"},
      }), {status: 201, headers: {"content-type": "application/json"}});
    });
    const client = new LeadConduitSubmissionClient(fetcher);

    await expect(client.send(lead, "Meta70")).resolves.toMatchObject({
      status: "sent", externalId: "123456789012345678901234",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.leadconduit.com/flows/6377949a81800d03d54119b5/sources/6a999da372afc3570dc712a1/submit",
      expect.objectContaining({method: "POST", headers: expect.objectContaining({"Content-Type": "application/x-www-form-urlencoded"})}),
    );
    const body = capturedInit?.body as URLSearchParams;
    expect(body.get("campaign_source")).toBe("Meta70");
    expect(body.has("redir_url")).toBe(false);
  });

  test("treats a transport error as retryable", async () => {
    const client = new LeadConduitSubmissionClient(vi.fn(async () => { throw new Error("network"); }));
    await expect(client.send(lead, "Meta30")).resolves.toEqual({
      status: "retryable_failed", externalId: null, reason: "transport_error",
    });
  });

  test("submits to the secondary ActiveProspect flow when selected", async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      outcome: "success", lead: {id: "123456789012345678901234"},
    }), {status: 201, headers: {"content-type": "application/json"}}));
    const client = new LeadConduitSubmissionClient(fetcher);

    await client.send(lead, "Meta70", "secondary");

    expect(fetcher).toHaveBeenCalledWith(
      "https://app.leadconduit.com/flows/68d597a7e5a45ce2a9c822fe/sources/6a999da372afc3570dc712a1/submit",
      expect.objectContaining({method: "POST"}),
    );
  });

  test("requires approved LeadConduit web submission URLs", () => {
    const solar = "https://app.leadconduit.com/flows/123456789012345678901234/sources/123456789012345678901235/submit";
    const roofing = "https://app.leadconduit.com/flows/68d597a7e5a45ce2a9c822fe/sources/123456789012345678901236/submit";
    expect(resolveWebLeadConduitUrls(solar, roofing)).toEqual({"Web Solar": solar, "Web Roofing": roofing});
    expect(resolveWebLeadConduitUrls(roofing, roofing)).toBeNull();
    expect(resolveWebLeadConduitUrls(solar, roofing.replace("app.leadconduit.com", "example.com"))).toBeNull();
  });

  test.each(["Web Solar", "Web Roofing"] as const)("sends %s to the configured web source only", async (source) => {
    const urls = {"Web Solar": "https://example.test/solar", "Web Roofing": "https://example.test/roofing"};
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      outcome: "success", lead: {id: "123456789012345678901234"},
    }), {status: 201}));
    const client = new LeadConduitSubmissionClient(fetcher, urls);
    await expect(client.send(lead, source)).resolves.toMatchObject({status: "sent"});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(urls[source], expect.objectContaining({
      redirect: "error",
      body: expect.any(URLSearchParams),
    }));
    const body = vi.mocked(fetcher).mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("original_source")).toBe(source);
    expect(body.get("campaign_source")).toBe(source);
    await expect(new LeadConduitSubmissionClient(fetcher).send(lead, source))
      .resolves.toMatchObject({status: "permanent_failed"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("sends the internal notification with an idempotency key", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({id: "email-123"}), {
        status: 200, headers: {"content-type": "application/json"},
      });
    });
    const client = new ResendLeadNotificationClient({
      apiKey: "re_test", fromEmail: "leads@allseason.solar",
      appBaseUrl: "https://piw.example.com", fetcher,
    });

    await expect(client.send(lead, "Meta30")).resolves.toMatchObject({
      status: "sent", externalId: "email-123",
    });
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({"Idempotency-Key": `lead-notification/${lead.id}`}),
    }));
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.to).toEqual(["roofingleads@allseason.solar"]);
    expect(body.text).toContain("Meta30");
  });

  test.each([429, 503])("retries Resend HTTP %s", async (status) => {
    const client = new ResendLeadNotificationClient({
      apiKey: "re_test", fromEmail: "leads@allseason.solar",
      appBaseUrl: "https://piw.example.com", fetcher: vi.fn(async () => new Response("{}", {status})),
    });
    await expect(client.send(lead, "Meta70")).resolves.toMatchObject({status: "retryable_failed"});
  });
});
