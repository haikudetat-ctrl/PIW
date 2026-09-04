import { describe, expect, test, vi } from "vitest";
import {
  buildMetaCapiPayload,
  classifyMetaResponse,
  MetaConversionClient,
  type MetaDeliveryResult,
} from "./meta-conversions";
import { SupabaseMetaRepository } from "./meta-repository";
import type { MetaDeliverySource } from "./meta-events";

const fixture: MetaDeliverySource = {
  deliveryId: "90000000-0000-4000-8000-000000000001",
  eventName: "QualifiedLead",
  eventId: "90000000-0000-4000-8000-000000000002",
  eventTime: "2026-09-01T12:00:00.000Z",
  eventSourceUrl: "https://allseasonsolar.net/form/thank-you?lead=private",
  email: " Chris@Example.COM ",
  phone: "(732) 555-0124",
  clientIpAddress: "203.0.113.10",
  clientUserAgent: "Mozilla/5.0 Test",
  fbp: "fb.1.100.200",
  fbc: "fb.1.100.click",
};

const deliveryRow = {
  id: fixture.deliveryId,
  company_id: "90000000-0000-4000-8000-000000000003",
  lead_id: "90000000-0000-4000-8000-000000000004",
  assessment_id: null,
  consent_id: "90000000-0000-4000-8000-000000000005",
  policy_version: "piw-privacy-v1",
  event_name: "QualifiedLead",
  event_id: fixture.eventId,
  event_time: fixture.eventTime,
  status: "sending",
  attempt_count: 1,
  payload_hash: null,
  meta_http_status: null,
  meta_trace_id: null,
  last_error_category: null,
  last_attempted_at: fixture.eventTime,
  sent_at: null,
  created_at: fixture.eventTime,
  updated_at: fixture.eventTime,
};

describe("Meta payload construction", () => {
  test("payload contains no property or pricing data", () => {
    const payload = buildMetaCapiPayload(fixture);
    expect(payload.data[0]).toMatchObject({
      event_name: "QualifiedLead",
      event_id: fixture.eventId,
      event_time: 1788264000,
      action_source: "website",
      event_source_url: "https://allseasonsolar.net/",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /submitted_address|canonical_address|roof|price|package|answer/i,
    );
    expect(payload.data[0].user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.data[0].user_data.ph[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.data[0]).not.toHaveProperty("custom_data");
  });

  test("omits absent attribution values instead of emitting nulls", () => {
    const payload = buildMetaCapiPayload({
      ...fixture,
      clientIpAddress: null,
      clientUserAgent: null,
      fbp: null,
      fbc: null,
    });

    expect(payload.data[0].user_data).toEqual({
      em: ["b4b5b0add35b4959f546b421b30cee70dad83efbce876d4a4d927f9a085efc78"],
      ph: ["c67d0280f6fcab534eb6ffd1e809159d9e1eac90670b2ea506aeafb71562a69f"],
    });
  });

  test("rejects event source URLs outside the canonical origin allowlist", () => {
    expect(() => buildMetaCapiPayload({
      ...fixture,
      eventSourceUrl: "https://attacker.example/collect",
    })).toThrow(/event source/i);
  });

  test.each([
    [408, "retryable"],
    [429, "retryable"],
    [500, "retryable"],
    [503, "retryable"],
    [400, "permanent"],
    [401, "permanent"],
    [403, "permanent"],
  ] as const)("classifies Meta HTTP %i as %s", (status, expected) => {
    expect(classifyMetaResponse(status)).toBe(expected);
  });
});

describe("MetaConversionClient", () => {
  test.each([
    ["Pixel ID", { pixelId: "pixel/3142520615938086" }],
    ["Graph API version", { graphApiVersion: "latest" }],
    ["access token", { accessToken: "   " }],
  ])("returns a permanent sanitized failure for an invalid local %s", async (_label, override) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new MetaConversionClient({
      pixelId: "3142520615938086",
      accessToken: "private-token",
      graphApiVersion: "v26.0",
      fetchImpl,
      ...override,
    });

    const result = await client.send(fixture);

    expect(result).toEqual({
      outcome: "permanent_failed",
      httpStatus: null,
      traceId: null,
      errorCategory: "invalid_config",
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(result)).not.toMatch(/private-token|Chris@Example\.COM/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    ["event time", { eventTime: "not-a-date" }],
    ["event source URL", { eventSourceUrl: "https://attacker.example/private-address" }],
    ["email", { email: "not-an-email" }],
    ["phone", { phone: "555-0124" }],
  ])("returns a permanent sanitized failure for an invalid local %s", async (_label, override) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new MetaConversionClient({
      pixelId: "3142520615938086",
      accessToken: "private-token",
      graphApiVersion: "v26.0",
      fetchImpl,
    });

    const result = await client.send({ ...fixture, ...override });

    expect(result).toEqual({
      outcome: "permanent_failed",
      httpStatus: null,
      traceId: null,
      errorCategory: "invalid_payload",
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-token|not-an-email|private-address|Chris@Example\.COM/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("sends the access token in the body and returns only allowlisted success fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      events_received: 1,
      fbtrace_id: "trace-123",
      messages: ["must not escape"],
      raw_secret: "must not escape",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new MetaConversionClient({
      pixelId: "3142520615938086",
      accessToken: "private-token",
      graphApiVersion: "v26.0",
      testEventCode: "TEST123",
      fetchImpl,
    });

    const result = await client.send(fixture);

    expect(result).toMatchObject({
      outcome: "sent",
      httpStatus: 200,
      traceId: "trace-123",
      errorCategory: null,
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result).not.toHaveProperty("eventsReceived");
    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.facebook.com/v26.0/3142520615938086/events",
    );
    expect(String(url)).not.toContain("private-token");
    expect(request?.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      access_token: "private-token",
      test_event_code: "TEST123",
      data: expect.any(Array),
    });
    expect(JSON.stringify(result)).not.toMatch(/private-token|must not escape/);
  });

  test("classifies and sanitizes a Meta HTTP error without returning its body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "raw address and token details must never escape",
        type: "OAuth Exception!!",
        code: 190,
      },
    }), { status: 401, headers: { "content-type": "application/json" } }));
    const client = new MetaConversionClient({
      pixelId: "3142520615938086",
      accessToken: "private-token",
      graphApiVersion: "v26.0",
      fetchImpl,
    });

    const result = await client.send(fixture);

    expect(result).toMatchObject({
      outcome: "permanent_failed",
      httpStatus: 401,
      traceId: null,
      errorCategory: "meta_oauth_exception:190",
    });
    expect(JSON.stringify(result)).not.toMatch(/address|token details|private-token/);
  });

  test("does not retain unrecognized response diagnostics", async () => {
    const successClient = new MetaConversionClient({
      pixelId: "3142520615938086",
      accessToken: "private-token",
      graphApiVersion: "v26.0",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        events_received: 1,
        fbtrace_id: "owner@example.com",
      }), { status: 200 })),
    });
    const errorClient = new MetaConversionClient({
      pixelId: "3142520615938086",
      accessToken: "private-token",
      graphApiVersion: "v26.0",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        error: { type: "Customer Address", code: 400 },
      }), { status: 400 })),
    });

    await expect(successClient.send(fixture)).resolves.toMatchObject({ traceId: null });
    await expect(errorClient.send(fixture)).resolves.toMatchObject({
      errorCategory: "meta_error:400",
    });
  });

  test("retries network errors with no raw diagnostic", async () => {
    const client = new MetaConversionClient({
      pixelId: "3142520615938086",
      accessToken: "private-token",
      graphApiVersion: "v26.0",
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(
        new Error("request included raw email chris@example.com"),
      ),
    });

    expect(await client.send(fixture)).toMatchObject({
      outcome: "retryable_failed",
      httpStatus: null,
      traceId: null,
      errorCategory: "network_error",
    });
  });

  test("aborts a stalled request after eight seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }));
      const client = new MetaConversionClient({
        pixelId: "3142520615938086",
        accessToken: "private-token",
        graphApiVersion: "v26.0",
        fetchImpl,
      });

      const pending = client.send(fixture);
      await vi.advanceTimersByTimeAsync(7_999);
      expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toMatchObject({
        outcome: "retryable_failed",
        httpStatus: null,
        errorCategory: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SupabaseMetaRepository", () => {
  test("returns a delivery id and browser envelope from a strict reservation", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...deliveryRow, status: "pending", attempt_count: 0, last_attempted_at: null }],
      error: null,
    });
    const repository = new SupabaseMetaRepository({ rpc } as never, () => fixture.eventTime);

    await expect(repository.reserveQualifiedLead({
      leadId: deliveryRow.lead_id,
      companyId: deliveryRow.company_id,
      consentId: deliveryRow.consent_id,
      occurredAt: fixture.eventTime,
    })).resolves.toEqual({
      deliveryId: fixture.deliveryId,
      envelope: {
        name: "QualifiedLead",
        eventId: fixture.eventId,
        issuedAt: fixture.eventTime,
      },
    });
    expect(rpc).toHaveBeenCalledWith("reserve_meta_qualified_lead_delivery", {
      p_lead_id: deliveryRow.lead_id,
      p_company_id: deliveryRow.company_id,
      p_consent_id: deliveryRow.consent_id,
      p_policy_version: "piw-privacy-v1",
      p_event_time: fixture.eventTime,
    });
  });

  test("reserves an assessment with the custom-event browser envelope", async () => {
    const assessmentId = "90000000-0000-4000-8000-000000000006";
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        ...deliveryRow,
        assessment_id: assessmentId,
        event_name: "AssessmentCompleted",
        status: "pending",
        attempt_count: 0,
        last_attempted_at: null,
      }],
      error: null,
    });
    const repository = new SupabaseMetaRepository({ rpc } as never, () => fixture.eventTime);

    await expect(repository.reserveAssessment({
      assessmentId,
      companyId: deliveryRow.company_id,
      consentId: deliveryRow.consent_id,
      occurredAt: fixture.eventTime,
    })).resolves.toEqual({
      deliveryId: fixture.deliveryId,
      envelope: {
        name: "AssessmentCompleted",
        eventId: fixture.eventId,
        issuedAt: fixture.eventTime,
      },
    });
    expect(rpc).toHaveBeenCalledWith("reserve_meta_assessment_delivery", {
      p_assessment_id: assessmentId,
      p_company_id: deliveryRow.company_id,
      p_consent_id: deliveryRow.consent_id,
      p_policy_version: "piw-privacy-v1",
      p_event_time: fixture.eventTime,
    });
  });

  test("does not query contact data when the atomic claim returns no row", async () => {
    const from = vi.fn();
    const repository = new SupabaseMetaRepository({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      from,
    } as never, () => fixture.eventTime);

    await expect(repository.claim(fixture.deliveryId)).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  test.each([
    ["reserveQualifiedLead", (repository: SupabaseMetaRepository) => repository.reserveQualifiedLead({
      leadId: deliveryRow.lead_id,
      companyId: deliveryRow.company_id,
      consentId: deliveryRow.consent_id,
      occurredAt: fixture.eventTime,
    })],
    ["claim", (repository: SupabaseMetaRepository) => repository.claim(fixture.deliveryId)],
    ["listPending", (repository: SupabaseMetaRepository) => repository.listPending(50)],
  ] as const)("rejects null RPC data during %s instead of reporting no work", async (operation, invoke) => {
    const from = vi.fn();
    const repository = new SupabaseMetaRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from,
    } as never, () => fixture.eventTime);

    await expect(invoke(repository)).rejects.toThrow(
      `Meta delivery persistence failed during ${operation}`,
    );
    expect(from).not.toHaveBeenCalled();
  });

  test("relies on the atomic database claim before resolving contact and attribution", async () => {
    const order: string[] = [];
    const contactMaybeSingle = vi.fn(async () => {
      order.push("contact");
      return {
        data: {
          email: fixture.email,
          phone: fixture.phone,
          client_ip_address: fixture.clientIpAddress,
          client_user_agent: fixture.clientUserAgent,
          fbp: fixture.fbp,
          fbc: fixture.fbc,
        },
        error: null,
      };
    });
    const contactQuery = {
      select: vi.fn(() => contactQuery),
      eq: vi.fn(() => contactQuery),
      maybeSingle: contactMaybeSingle,
    };
    const repository = new SupabaseMetaRepository({
      rpc: vi.fn(async () => {
        order.push("claim");
        return { data: [deliveryRow], error: null };
      }),
      from: vi.fn(() => contactQuery),
    } as never, () => fixture.eventTime);

    await expect(repository.claim(fixture.deliveryId)).resolves.toEqual({
      ...fixture,
      eventSourceUrl: "https://allseasonsolar.net/",
    });
    expect(order).toEqual(["claim", "contact"]);
    expect(contactQuery.select).toHaveBeenCalledWith(
      "email, phone, client_ip_address, client_user_agent, fbp, fbc",
    );
  });

  test("rejects malformed RPC rows instead of accepting partial state", async () => {
    const repository = new SupabaseMetaRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [{ id: fixture.deliveryId, event_name: "Lead" }],
        error: null,
      }),
    } as never, () => fixture.eventTime);

    await expect(repository.reserveQualifiedLead({
      leadId: deliveryRow.lead_id,
      companyId: deliveryRow.company_id,
      consentId: deliveryRow.consent_id,
      occurredAt: fixture.eventTime,
    })).rejects.toThrow();
  });

  test("rejects a shape-valid reservation for the wrong event contract", async () => {
    const repository = new SupabaseMetaRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [{
          ...deliveryRow,
          event_name: "AssessmentCompleted",
          assessment_id: "90000000-0000-4000-8000-000000000006",
        }],
        error: null,
      }),
    } as never, () => fixture.eventTime);

    await expect(repository.reserveQualifiedLead({
      leadId: deliveryRow.lead_id,
      companyId: deliveryRow.company_id,
      consentId: deliveryRow.consent_id,
      occurredAt: fixture.eventTime,
    })).rejects.toThrow(/reserveQualifiedLead/);
  });

  test("lists only strict pending-delivery identifiers", async () => {
    const secondId = "90000000-0000-4000-8000-000000000007";
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: fixture.deliveryId }, { id: secondId }],
      error: null,
    });
    const repository = new SupabaseMetaRepository({ rpc } as never, () => fixture.eventTime);

    await expect(repository.listPending(50)).resolves.toEqual([
      fixture.deliveryId,
      secondId,
    ]);
    expect(rpc).toHaveBeenCalledWith("list_pending_meta_deliveries", {
      p_limit: 50,
      p_observed_at: fixture.eventTime,
    });
  });

  test("completes with the reviewed six-argument diagnostic contract", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        ...deliveryRow,
        status: "sent",
        payload_hash: "a".repeat(64),
        meta_http_status: 200,
        meta_trace_id: "trace-123",
        sent_at: fixture.eventTime,
      }],
      error: null,
    });
    const repository = new SupabaseMetaRepository({ rpc } as never, () => fixture.eventTime);
    const result: MetaDeliveryResult = {
      outcome: "sent",
      httpStatus: 200,
      traceId: "trace-123",
      errorCategory: null,
      payloadHash: "a".repeat(64),
    };

    await repository.complete(fixture.deliveryId, result);

    expect(rpc).toHaveBeenCalledWith("complete_meta_delivery", {
      p_delivery_id: fixture.deliveryId,
      p_status: "sent",
      p_meta_http_status: 200,
      p_payload_hash: "a".repeat(64),
      p_diagnostic: "trace-123",
      p_completed_at: fixture.eventTime,
    });
  });

  test("accepts the terminal database outcome when a retryable fifth attempt is exhausted", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        ...deliveryRow,
        status: "permanent_failed",
        attempt_count: 5,
        payload_hash: "a".repeat(64),
        meta_http_status: 408,
        last_error_category: "retry_exhausted",
      }],
      error: null,
    });
    const repository = new SupabaseMetaRepository({rpc} as never, () => fixture.eventTime);

    await expect(repository.complete(fixture.deliveryId, {
      outcome: "retryable_failed",
      httpStatus: 408,
      traceId: null,
      errorCategory: "http_408",
      payloadHash: "a".repeat(64),
    })).resolves.toBe("permanent_failed");
  });
});
