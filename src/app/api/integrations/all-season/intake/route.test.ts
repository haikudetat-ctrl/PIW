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

function request(body: unknown, secret = "shared-secret") {
  return new NextRequest("https://piw.example/api/integrations/all-season/intake", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-all-season-intake-secret": secret,
    },
    body: JSON.stringify(body),
  });
}

describe("All Season lead intake", () => {
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
});
