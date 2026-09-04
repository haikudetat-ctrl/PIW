import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handleAllSeasonIntakeRequest } from "./route";

const validPayload = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  name: "Alex Rivera",
  email: "alex@example.com",
  phone: "201-555-0100",
  address: "1 Main St, Newark, NJ",
  google_place_id: "ChIJ-selected",
  project_interest: "solar" as const,
  consent_to_contact: true as const,
  consent_to_process_property: true as const,
  source: "all-season-website" as const,
  submittedAt: "2026-08-18T14:00:00.000Z",
  attribution: {
    fbclid: "click-123",
    fbp: "fb.1.100.200",
    fbc: "fb.1.100.click",
  },
};

function request(
  body: unknown,
  secret = "shared-secret",
  headers: Record<string, string> = {},
) {
  return new NextRequest("https://piw.example/api/integrations/all-season/intake", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-all-season-intake-secret": secret,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("All Season lead intake", () => {
  const advertisingConsent = {
    policyVersion: "piw-privacy-v1" as const,
    consentId: "33333333-3333-4333-8333-333333333333",
    preferences: {necessary: true as const, analytics: false, advertising: true},
    gpcDetected: false,
    updatedAt: "2026-09-01T16:00:00.000Z",
  };

  test("rejects a request with the wrong shared secret", async () => {
    const accept = vi.fn();

    const response = await handleAllSeasonIntakeRequest(
      request(validPayload, "wrong-secret"),
      { expectedSecret: "shared-secret", accept },
    );

    expect(response.status).toBe(401);
    expect(accept).not.toHaveBeenCalled();
  });

  test.each(["roofing", "solar", "both"] as const)(
    "accepts a consented %s lead",
    async (projectInterest) => {
      const accept = vi.fn(async () => ({
        leadId: "22222222-2222-4222-8222-222222222222",
        duplicate: false,
      }));

      const response = await handleAllSeasonIntakeRequest(
        request({ ...validPayload, project_interest: projectInterest }),
        { expectedSecret: "shared-secret", accept },
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        accepted: true,
        leadId: "22222222-2222-4222-8222-222222222222",
        duplicate: false,
        metaEvent: null,
      });
      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({ project_interest: projectInterest }),
      );
    },
  );

  test("canonicalizes a selected Google Place before accepting the lead", async () => {
    const accept = vi.fn(async () => ({
      leadId: "22222222-2222-4222-8222-222222222222",
      duplicate: false,
    }));
    const normalizeAddress = vi.fn(async () =>
      "354 Stockton St, Princeton, NJ 08540, USA"
    );

    const response = await handleAllSeasonIntakeRequest(request(validPayload), {
      expectedSecret: "shared-secret",
      accept,
      normalizeAddress,
    });

    expect(response.status).toBe(202);
    expect(normalizeAddress).toHaveBeenCalledWith({
      submittedAddress: "1 Main St, Newark, NJ",
      googlePlaceId: "ChIJ-selected",
    });
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      address: "354 Stockton St, Princeton, NJ 08540, USA",
      google_place_id: "ChIJ-selected",
    }));
  });

  test("rejects a lead without property-processing consent", async () => {
    const accept = vi.fn();

    const response = await handleAllSeasonIntakeRequest(
      request({ ...validPayload, consent_to_process_property: false }),
      { expectedSecret: "shared-secret", accept },
    );

    expect(response.status).toBe(400);
    expect(accept).not.toHaveBeenCalled();
  });

  test("returns a retryable response when persistence fails", async () => {
    const reportError = vi.fn();
    const persistenceError = new Error("database unavailable");
    const response = await handleAllSeasonIntakeRequest(request(validPayload), {
      expectedSecret: "shared-secret",
      reportError,
      accept: async () => {
        throw persistenceError;
      },
    });

    expect(response.status).toBe(503);
    expect(reportError).toHaveBeenCalledWith(persistenceError);
  });

  test("returns QualifiedLead only after canonical persistence under advertising consent", async () => {
    const accept = vi.fn(async () => ({
      leadId: "22222222-2222-4222-8222-222222222222",
      duplicate: false,
    }));
    const verifyAdvertisingConsent = vi.fn(async () => advertisingConsent);
    const recordConsent = vi.fn(async () => undefined);
    const reserveQualifiedLead = vi.fn(async () => ({
      deliveryId: "44444444-4444-4444-8444-444444444444",
      envelope: {
        name: "QualifiedLead" as const,
        eventId: "55555555-5555-4555-8555-555555555555",
        issuedAt: "2026-09-01T16:01:00.000Z",
      },
    }));
    const requestDelivery = vi.fn(async () => undefined);

    const response = await handleAllSeasonIntakeRequest(
      request(validPayload, "shared-secret", {"x-piw-privacy-consent": "server-issued"}),
      {
        expectedSecret: "shared-secret",
        accept,
        verifyAdvertisingConsent,
        recordConsent,
        reserveQualifiedLead,
        requestDelivery,
        companyId: "66666666-6666-4666-8666-666666666666",
        metaTrackingEnabled: true,
      } as never,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      metaEvent: {
        name: "QualifiedLead",
        eventId: "55555555-5555-4555-8555-555555555555",
      },
    });
    expect(accept.mock.invocationCallOrder[0]).toBeLessThan(
      reserveQualifiedLead.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(recordConsent).toHaveBeenCalledWith(expect.objectContaining({
      leadId: "22222222-2222-4222-8222-222222222222",
      companyId: "66666666-6666-4666-8666-666666666666",
      consent: advertisingConsent,
    }));
    expect(requestDelivery).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
  });

  test("persistence failure emits no Meta delivery", async () => {
    const reserveQualifiedLead = vi.fn();

    const response = await handleAllSeasonIntakeRequest(
      request(validPayload),
      {
        expectedSecret: "shared-secret",
        accept: async () => {
          throw new Error("database unavailable");
        },
        reserveQualifiedLead,
      } as never,
    );

    expect(response.status).toBe(503);
    expect(reserveQualifiedLead).not.toHaveBeenCalled();
  });

  test("keeps the browser QualifiedLead envelope when immediate Meta publication fails", async () => {
    const reportError = vi.fn();
    const response = await handleAllSeasonIntakeRequest(
      request(validPayload),
      {
        expectedSecret: "shared-secret",
        companyId: "66666666-6666-4666-8666-666666666666",
        metaTrackingEnabled: true,
        accept: async () => ({
          leadId: "22222222-2222-4222-8222-222222222222",
          duplicate: false,
        }),
        verifyAdvertisingConsent: async () => advertisingConsent,
        recordConsent: async () => undefined,
        reserveQualifiedLead: async () => ({
          deliveryId: "44444444-4444-4444-8444-444444444444",
          envelope: {
            name: "QualifiedLead",
            eventId: "55555555-5555-4555-8555-555555555555",
            issuedAt: "2026-09-01T16:01:00.000Z",
          },
        }),
        requestDelivery: async () => {
          throw new Error("Inngest is unavailable");
        },
        reportError,
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      metaEvent: {eventId: "55555555-5555-4555-8555-555555555555"},
    });
    expect(reportError).toHaveBeenCalledOnce();
  });
});
