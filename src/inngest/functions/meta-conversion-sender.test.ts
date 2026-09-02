import {describe, expect, test, vi} from "vitest";
import type {MetaDeliveryResult} from "@/modules/marketing/meta-conversions";
import type {MetaDeliverySource} from "@/modules/marketing/meta-events";
import {
  sendMetaConversionDelivery,
  type MetaConversionDeliveryClient,
  type MetaConversionDeliveryRepository,
} from "./meta-conversion-sender";

const source: MetaDeliverySource = {
  deliveryId: "11111111-1111-4111-8111-111111111111",
  eventName: "Lead",
  eventId: "22222222-2222-4222-8222-222222222222",
  eventTime: "2026-09-01T12:00:00.000Z",
  eventSourceUrl: "https://allseasonsolar.net/",
  email: "alex@example.com",
  phone: "+1 609 555 0100",
  clientIpAddress: "203.0.113.10",
  clientUserAgent: "Mozilla/5.0",
  fbp: "fb.1.1.1.1",
  fbc: "fb.1.1.1.1",
};

const sent: MetaDeliveryResult = {
  outcome: "sent",
  httpStatus: 200,
  traceId: "trace-1",
  errorCategory: null,
  payloadHash: "a".repeat(64),
};

function repository(overrides: Partial<MetaConversionDeliveryRepository> = {}) {
  return {
    claim: vi.fn(async () => source),
    complete: vi.fn(async (_deliveryId, result) => result.outcome),
    ...overrides,
  } satisfies MetaConversionDeliveryRepository;
}

function client(overrides: Partial<MetaConversionDeliveryClient> = {}) {
  return {
    send: vi.fn(async () => sent),
    ...overrides,
  } satisfies MetaConversionDeliveryClient;
}

describe("Meta conversion sender", () => {
  test("sends one claimed delivery and records success", async () => {
    const deliveryRepository = repository();
    const deliveryClient = client();

    await expect(sendMetaConversionDelivery({deliveryId: source.deliveryId}, {
      repository: deliveryRepository,
      client: deliveryClient,
    })).resolves.toEqual({outcome: "sent", deliveryId: source.deliveryId});

    expect(deliveryClient.send).toHaveBeenCalledWith(source);
    expect(deliveryRepository.complete).toHaveBeenCalledWith(source.deliveryId, sent);
  });

  test("does nothing when an already claimed or completed delivery cannot be claimed", async () => {
    const deliveryRepository = repository({claim: vi.fn(async () => null)});
    const deliveryClient = client();

    await expect(sendMetaConversionDelivery({deliveryId: source.deliveryId}, {
      repository: deliveryRepository,
      client: deliveryClient,
    })).resolves.toEqual({outcome: "noop", deliveryId: source.deliveryId});

    expect(deliveryClient.send).not.toHaveBeenCalled();
    expect(deliveryRepository.complete).not.toHaveBeenCalled();
  });

  test("records a retryable failure before asking Inngest to retry", async () => {
    const retryable: MetaDeliveryResult = {
      ...sent,
      outcome: "retryable_failed",
      httpStatus: 503,
      traceId: null,
      errorCategory: "http_503",
    };
    const deliveryRepository = repository();

    await expect(sendMetaConversionDelivery({deliveryId: source.deliveryId}, {
      repository: deliveryRepository,
      client: client({send: vi.fn(async () => retryable)}),
    })).rejects.toThrow("Meta conversion delivery requires retry");

    expect(deliveryRepository.complete).toHaveBeenCalledWith(source.deliveryId, retryable);
  });

  test("records a permanent failure without retrying the Inngest function", async () => {
    const permanent: MetaDeliveryResult = {
      ...sent,
      outcome: "permanent_failed",
      httpStatus: 400,
      traceId: null,
      errorCategory: "invalid_payload",
    };
    const deliveryRepository = repository();

    await expect(sendMetaConversionDelivery({deliveryId: source.deliveryId}, {
      repository: deliveryRepository,
      client: client({send: vi.fn(async () => permanent)}),
    })).resolves.toEqual({outcome: "permanent_failed", deliveryId: source.deliveryId});

    expect(deliveryRepository.complete).toHaveBeenCalledWith(source.deliveryId, permanent);
  });

  test("does not ask Inngest to retry after the database exhausts the fifth transient attempt", async () => {
    const retryable: MetaDeliveryResult = {
      ...sent,
      outcome: "retryable_failed",
      httpStatus: 408,
      traceId: null,
      errorCategory: "http_408",
    };
    const deliveryRepository = repository({
      complete: vi.fn(async (): Promise<"permanent_failed"> => "permanent_failed"),
    });

    await expect(sendMetaConversionDelivery({deliveryId: source.deliveryId}, {
      repository: deliveryRepository,
      client: client({send: vi.fn(async () => retryable)}),
    })).resolves.toEqual({outcome: "permanent_failed", deliveryId: source.deliveryId});
  });
});
