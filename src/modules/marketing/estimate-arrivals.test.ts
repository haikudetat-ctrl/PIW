import { describe, expect, test, vi } from "vitest";
import {
  arrivalVisitorSalt,
  buildEstimateArrival,
  recordEstimateArrival,
  redactArrivalPath,
  shouldLogEstimateArrival,
} from "./estimate-arrivals";

const token = "t".repeat(43);
const companyId = "11111111-1111-4111-8111-111111111111";
const browser = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

function request(path: string, init: {method?: string; headers?: Record<string, string>} = {}) {
  return {
    method: init.method ?? "GET",
    nextUrl: new URL(`https://estimate.allseasonroofingquote.com${path}`),
    headers: new Headers(init.headers ?? {}),
  };
}

describe("shouldLogEstimateArrival", () => {
  test.each(["/roof-estimate", `/roof-estimate/p/${token}`, "/privacy"])("logs page loads of %s", (path) => {
    expect(shouldLogEstimateArrival(request(path))).toBe(true);
  });

  test.each(["/api/property-preview", "/fonts/montserrat.ttf", "/campaigns/x/hero.webp", "/roof-estimate-admin"])(
    "skips %s",
    (path) => {
      expect(shouldLogEstimateArrival(request(path))).toBe(false);
    },
  );

  test("skips non-GET requests, in-app navigations, and prefetches", () => {
    expect(shouldLogEstimateArrival(request("/roof-estimate", {method: "POST"}))).toBe(false);
    expect(shouldLogEstimateArrival(request("/roof-estimate", {headers: {rsc: "1"}}))).toBe(false);
    expect(shouldLogEstimateArrival(request("/roof-estimate", {headers: {"next-router-prefetch": "1"}}))).toBe(false);
    expect(shouldLogEstimateArrival(request("/roof-estimate", {headers: {"sec-purpose": "prefetch"}}))).toBe(false);
  });
});

describe("buildEstimateArrival", () => {
  test("records the ad tags and never the preview token or the raw IP", async () => {
    const url = new URL(
      `https://estimate.allseasonroofingquote.com/roof-estimate/p/${token}?utm_source=meta&utm_campaign=AC%20Expressway&utm_content=galloway&fbclid=click-1&campaign=for-every-season`,
    );
    const row = await buildEstimateArrival({
      url,
      headers: new Headers({"user-agent": browser, referer: "https://m.facebook.com/"}),
      ip: "203.0.113.7",
      salt: "salt",
      now: new Date("2026-10-09T12:00:00.000Z"),
      companyId,
    });

    expect(row).toMatchObject({
      company_id: companyId,
      request_path: "/roof-estimate/p/[token]",
      campaign_slug: "for-every-season",
      utm_source: "meta",
      utm_campaign: "AC Expressway",
      utm_content: "galloway",
      fbclid: "click-1",
      referrer_host: "m.facebook.com",
      is_likely_bot: false,
      experiment_arm: "value_first",
    });
    expect(row.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
  });

  test("flags crawlers and ignores unknown campaign values", async () => {
    const row = await buildEstimateArrival({
      url: new URL("https://estimate.allseasonroofingquote.com/roof-estimate?campaign=other"),
      headers: new Headers({"user-agent": "facebookexternalhit/1.1"}),
      ip: null,
      salt: "salt",
      now: new Date(),
      companyId,
    });
    expect(row.is_likely_bot).toBe(true);
    expect(row.campaign_slug).toBeNull();
  });
});

test("redactArrivalPath replaces token-length segments", () => {
  expect(redactArrivalPath(`/roof-estimate/${token}/result`)).toBe("/roof-estimate/[token]/result");
  expect(redactArrivalPath("/roof-estimate")).toBe("/roof-estimate");
});

test("arrivalVisitorSalt prefers an explicit salt and otherwise derives one from the intake secret", () => {
  expect(arrivalVisitorSalt({ARRIVAL_VISITOR_SALT: "explicit"})).toBe("explicit");
  expect(arrivalVisitorSalt({ALL_SEASON_INTAKE_SHARED_SECRET: "secret"})).toBe("estimate-arrivals:secret");
  expect(arrivalVisitorSalt({})).toBeNull();
});

describe("recordEstimateArrival", () => {
  function client(tenant: {company_id: string; verified_at: string | null} | null, insertError: unknown = null) {
    const insert = vi.fn(async () => ({error: insertError}));
    const maybeSingle = vi.fn(async () => ({data: tenant, error: null}));
    const from = vi.fn((table: string) => table === "website_arrivals"
      ? {insert}
      : {select: () => ({eq: () => ({maybeSingle})})});
    return {client: {from} as never, insert, from};
  }
  const environment = {ALL_SEASON_INTAKE_SHARED_SECRET: "secret", DEPLOYMENT_ENV: "production"};
  const page = request("/roof-estimate?utm_source=meta", {headers: {"user-agent": browser}});

  test("inserts one arrival for a verified tenant host", async () => {
    const fake = client({company_id: companyId, verified_at: "2026-10-01T00:00:00.000Z"});
    await recordEstimateArrival(page, "estimate.allseasonroofingquote.com", {client: fake.client, environment});
    expect(fake.insert).toHaveBeenCalledOnce();
    expect(fake.insert.mock.calls[0]).toEqual([expect.objectContaining({company_id: companyId, utm_source: "meta"})]);
  });

  test("records nothing for an unverified host or without a salt", async () => {
    const unverified = client({company_id: companyId, verified_at: null});
    await recordEstimateArrival(page, "estimate.example.com", {client: unverified.client, environment});
    expect(unverified.insert).not.toHaveBeenCalled();

    const unconfigured = client({company_id: companyId, verified_at: "2026-10-01T00:00:00.000Z"});
    await recordEstimateArrival(page, "estimate.allseasonroofingquote.com", {client: unconfigured.client, environment: {}});
    expect(unconfigured.from).not.toHaveBeenCalled();
  });

  test("never throws when the insert fails", async () => {
    const failing = client({company_id: companyId, verified_at: "2026-10-01T00:00:00.000Z"}, {code: "500"});
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordEstimateArrival(page, "estimate.allseasonroofingquote.com", {client: failing.client, environment}))
      .resolves.toBeUndefined();
    error.mockRestore();
  });
});
