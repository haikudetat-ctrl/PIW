import {afterEach, describe, expect, test, vi} from "vitest";
import {loadAssessmentAerial} from "./assessment-aerial-loader";

const imageSrc = "/api/roof-estimate/11111111-1111-4111-8111-111111111111/house-image";

function response(body: BodyInit | null, status: number, headers?: HeadersInit) {
  return new Response(body, {status, headers});
}

describe("assessment aerial loader", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("creates an object URL only for a successful image blob", async () => {
    const image = new Blob([new Uint8Array([1, 2, 3])], {type: "image/jpeg"});
    const fetchFn = vi.fn(async () => response(image, 200, {"content-type": "image/jpeg"}));
    const createObjectURL = vi.fn((_blob: Blob) => "blob:assessment-aerial");
    const signal = new AbortController().signal;

    await expect(loadAssessmentAerial({
      imageSrc,
      signal,
      fetchFn,
      createObjectURL,
    })).resolves.toEqual({kind: "ready", objectUrl: "blob:assessment-aerial"});
    expect(fetchFn).toHaveBeenCalledWith(imageSrc, {signal});
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  });

  test("keeps coordinates_pending private and returns a retry instruction", async () => {
    const createObjectURL = vi.fn();

    await expect(loadAssessmentAerial({
      imageSrc,
      signal: new AbortController().signal,
      fetchFn: async () => response(
        JSON.stringify({error: "Property image unavailable", outcome: "coordinates_pending"}),
        404,
        {"content-type": "application/json"},
      ),
      createObjectURL,
    })).resolves.toEqual({kind: "retry", delayMs: 2_500});
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("treats a provider 502 as retryable", async () => {
    await expect(loadAssessmentAerial({
      imageSrc,
      signal: new AbortController().signal,
      fetchFn: async () => response(JSON.stringify({error: "provider failed"}), 502),
      createObjectURL: vi.fn(),
    })).resolves.toEqual({kind: "retry", delayMs: 2_500});
  });

  test("honors an integer Retry-After value in seconds", async () => {
    await expect(loadAssessmentAerial({
      imageSrc,
      signal: new AbortController().signal,
      fetchFn: async () => response(null, 404, {"retry-after": "7"}),
      createObjectURL: vi.fn(),
    })).resolves.toEqual({kind: "retry", delayMs: 7_000});
  });

  test("honors an HTTP-date Retry-After value", async () => {
    const now = new Date("2026-08-28T16:00:00.000Z").getTime();

    await expect(loadAssessmentAerial({
      imageSrc,
      signal: new AbortController().signal,
      fetchFn: async () => response(null, 502, {
        "retry-after": "Fri, 28 Aug 2026 16:00:04 GMT",
      }),
      createObjectURL: vi.fn(),
      now: () => now,
    })).resolves.toEqual({kind: "retry", delayMs: 4_000});
  });

  test("falls back to 2.5 seconds for an invalid Retry-After value", async () => {
    await expect(loadAssessmentAerial({
      imageSrc,
      signal: new AbortController().signal,
      fetchFn: async () => response(null, 502, {"retry-after": "soon"}),
      createObjectURL: vi.fn(),
    })).resolves.toEqual({kind: "retry", delayMs: 2_500});
  });

  test("returns unavailable for a non-retryable response", async () => {
    await expect(loadAssessmentAerial({
      imageSrc,
      signal: new AbortController().signal,
      fetchFn: async () => response(null, 401),
      createObjectURL: vi.fn(),
    })).resolves.toEqual({kind: "unavailable"});
  });

  test("passes abort cleanup through to an in-flight request", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    }));
    const pending = loadAssessmentAerial({
      imageSrc,
      signal: controller.signal,
      fetchFn,
      createObjectURL: vi.fn(),
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({name: "AbortError"});
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
