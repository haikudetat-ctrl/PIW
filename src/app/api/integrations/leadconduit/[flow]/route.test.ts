import { describe, expect, it } from "vitest";
import type { LeadConduitEventBatch } from "@/modules/access-route/contracts";
import type { LeadConduitFlowBinding } from "@/modules/access-route/leadconduit-config";
import {
  handleLeadConduitShadowRequest,
  type LeadConduitShadowRouteDependencies,
} from "./route";

const COMPANY_ID = "00000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-08-12T16:00:00.000Z");
const ACTIVE_TOKEN = "synthetic-roofing-active-token";
const NEXT_TOKEN = "synthetic-roofing-next-token";

function binding(overrides: Partial<LeadConduitFlowBinding> = {}): LeadConduitFlowBinding {
  return {
    slug: "roofing",
    companyId: COMPANY_ID,
    flowId: "synthetic-roofing-flow",
    flowName: "Roofing",
    receiptEnabled: true,
    tokens: [{ value: ACTIVE_TOKEN, validUntil: null }],
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    lead_id: "synthetic-lead-101",
    flow_id: "synthetic-roofing-flow",
    checkpoint: "after_corelogic",
    source: { id: "synthetic-source", name: "Synthetic Source" },
    submitted_at: "2026-08-12T15:59:00.000Z",
    is_test: true,
    lead: {
      name: "Synthetic Homeowner",
      phone: "+1 609 555 0101",
      email: "synthetic@example.invalid",
      submitted_address: "101 Synthetic Way",
      trustedform_url: "https://example.invalid/synthetic-certificate",
    },
    corelogic: {
      outcome: "Success",
      reason: "Synthetic reason",
      building_comments: "Single Family",
      site_land_use: "Single Family",
    },
    ...overrides,
  };
}

function request(
  body: unknown = payload(),
  options: { authorization?: string; contentType?: string; contentLength?: string } = {},
): Request {
  return new Request("https://piw.example.invalid/api/integrations/leadconduit/roofing", {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
      ...(options.contentLength === undefined ? {} : { "content-length": options.contentLength }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function throwingBodyRequest(authorization: string | undefined): Request {
  const body = new ReadableStream<Uint8Array>({
    pull() {
      throw new Error("the request body must not be read");
    },
  });
  return {
    headers: new Headers({
      ...(authorization === undefined ? {} : { authorization }),
      "content-type": "application/json",
    }),
    body,
  } as Request;
}

function streamingRequest(chunks: Uint8Array[], contentLength: string): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Request("https://piw.example.invalid/api/integrations/leadconduit/roofing", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ACTIVE_TOKEN}`,
      "content-type": "application/json",
      "content-length": contentLength,
    },
    body,
    duplex: "half",
  } as RequestInit);
}

function makeDependencies(overrides: Partial<LeadConduitShadowRouteDependencies> = {}) {
  const persisted: LeadConduitEventBatch[] = [];
  const rowsByEventId = new Map<string, LeadConduitEventBatch["rows"][number]>();
  const deps: LeadConduitShadowRouteDependencies = {
    getBinding: () => binding(),
    persist: async (input) => {
      persisted.push(input);
      for (const row of input.rows) rowsByEventId.set(row.event_id, row);
      return input.rows.length;
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, persisted, rowsByEventId };
}

async function handle(body: unknown = payload(), dependencies = makeDependencies()) {
  const result = await handleLeadConduitShadowRequest(
    request(body, { authorization: `Bearer ${ACTIVE_TOKEN}` }),
    "roofing",
    dependencies.deps,
  );
  return { result, ...dependencies };
}

describe("LeadConduit shadow receipt pre-body gate", () => {
  it.each([
    ["unknown flow", "unknown-flow", () => makeDependencies({ getBinding: (flow) => flow === "roofing" ? binding() : null }).deps],
    ["unavailable binding", "roofing", () => makeDependencies({ getBinding: () => null }).deps],
    ["disabled receiver", "roofing", () => makeDependencies({ getBinding: () => binding({ receiptEnabled: false }) }).deps],
  ])("returns disabled before reading a body for %s", async (_caseName, flow, dependenciesFactory) => {
    const result = await handleLeadConduitShadowRequest(
      throwingBodyRequest(`Bearer ${ACTIVE_TOKEN}`),
      flow,
      dependenciesFactory(),
    );

    expect(result).toEqual({ status: 503, body: { outcome: "retry", category: "disabled" } });
  });

  it.each([
    ["missing", undefined],
    ["malformed", "Basic synthetic-roofing-active-token"],
    ["wrong", "Bearer different-token"],
    ["cross-flow", "Bearer synthetic-virtual-quote-token"],
  ])("returns a generic unauthorized response for a %s bearer token", async (_caseName, authorization) => {
    const { deps, persisted } = makeDependencies();
    const result = await handleLeadConduitShadowRequest(
      throwingBodyRequest(authorization),
      "roofing",
      deps,
    );

    expect(result).toEqual({ status: 401, body: { outcome: "unauthorized" } });
    expect(persisted).toEqual([]);
  });

  it("accepts an active bearer token and an unexpired next bearer token", async () => {
    const { deps, persisted } = makeDependencies({
      getBinding: () => binding({
        tokens: [
          { value: ACTIVE_TOKEN, validUntil: null },
          { value: NEXT_TOKEN, validUntil: "2026-08-12T17:00:00.000Z" },
        ],
      }),
    });

    const active = await handleLeadConduitShadowRequest(request(payload(), { authorization: `Bearer ${ACTIVE_TOKEN}` }), "roofing", deps);
    const next = await handleLeadConduitShadowRequest(request(payload({ lead_id: "synthetic-lead-102" }), { authorization: `Bearer ${NEXT_TOKEN}` }), "roofing", deps);

    expect(active).toEqual({ status: 200, body: { outcome: "success" } });
    expect(next).toEqual({ status: 200, body: { outcome: "success" } });
    expect(persisted).toHaveLength(2);
  });

  it("does not accept an expired next bearer token present in a stale binding", async () => {
    const { deps, persisted } = makeDependencies({
      getBinding: () => binding({ tokens: [{ value: NEXT_TOKEN, validUntil: "2026-08-12T15:00:00.000Z" }] }),
    });

    const result = await handleLeadConduitShadowRequest(
      throwingBodyRequest(`Bearer ${NEXT_TOKEN}`),
      "roofing",
      deps,
    );

    expect(result).toEqual({ status: 401, body: { outcome: "unauthorized" } });
    expect(persisted).toEqual([]);
  });
});

describe("LeadConduit shadow receipt bounded parsing", () => {
  it("sanitizes a request-body stream failure", async () => {
    const { deps, persisted } = makeDependencies();
    const result = await handleLeadConduitShadowRequest(
      throwingBodyRequest(`Bearer ${ACTIVE_TOKEN}`),
      "roofing",
      deps,
    );

    expect(result).toEqual({ status: 400, body: { outcome: "invalid", category: "invalid_payload" } });
    expect(persisted).toEqual([]);
  });

  it("rejects a non-JSON content type without persistence", async () => {
    const { deps, persisted } = makeDependencies();
    const result = await handleLeadConduitShadowRequest(
      request("not json", { authorization: `Bearer ${ACTIVE_TOKEN}`, contentType: "text/plain" }),
      "roofing",
      deps,
    );

    expect(result).toEqual({ status: 400, body: { outcome: "invalid", category: "invalid_payload" } });
    expect(persisted).toEqual([]);
  });

  it("sanitizes malformed JSON failures without submitted content", async () => {
    const secret = "synthetic-value-that-must-not-echo";
    const { deps, persisted } = makeDependencies();
    const result = await handleLeadConduitShadowRequest(
      request(`{"lead_id":"${secret}"`, { authorization: `Bearer ${ACTIVE_TOKEN}` }),
      "roofing",
      deps,
    );

    expect(result).toEqual({ status: 400, body: { outcome: "invalid", category: "invalid_payload" } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(persisted).toEqual([]);
  });

  it("returns sorted invalid field names without submitted values", async () => {
    const secret = "synthetic-value-that-must-not-echo";
    const { deps, persisted } = makeDependencies();
    const result = await handleLeadConduitShadowRequest(
      request(payload({
        extra: secret,
        lead: { ...payload().lead, secret_note: secret },
        corelogic: { ...payload().corelogic, debug: secret },
      }), { authorization: `Bearer ${ACTIVE_TOKEN}` }),
      "roofing",
      deps,
    );

    expect(result).toEqual({
      status: 400,
      body: {
        outcome: "invalid",
        category: "invalid_payload",
        invalidFields: ["corelogic.debug", "extra", "lead.secret_note"],
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(persisted).toEqual([]);
  });

  it("stops an oversized stream before JSON parsing even when Content-Length is smaller", async () => {
    const encoder = new TextEncoder();
    const { deps, persisted } = makeDependencies();
    const result = await handleLeadConduitShadowRequest(
      streamingRequest([encoder.encode("{"), encoder.encode("x".repeat(65_536))], "1"),
      "roofing",
      deps,
    );

    expect(result).toEqual({ status: 413, body: { outcome: "retry", category: "payload_too_large" } });
    expect(persisted).toEqual([]);
  });

  it.each([
    ["flow ID", payload({ flow_id: "different-flow" })],
    ["checkpoint", payload({ checkpoint: "before_corelogic" })],
  ])("rejects a mismatched trusted %s without persistence", async (_name, body) => {
    const { deps, persisted } = makeDependencies();
    const result = await handleLeadConduitShadowRequest(
      request(body, { authorization: `Bearer ${ACTIVE_TOKEN}` }),
      "roofing",
      deps,
    );

    expect(result).toEqual({ status: 401, body: { outcome: "unauthorized" } });
    expect(persisted).toEqual([]);
  });
});

describe("LeadConduit shadow receipt persistence", () => {
  it.each([
    ["apartment", payload({ corelogic: { ...payload().corelogic, building_comments: "APARTMENT HOUSE" } }), "apartment_classification"],
    ["Roofing multiple-property", payload({ corelogic: { ...payload().corelogic, reason: "Incomplete address. Multiple property results returned." } }), "multiple_property_match"],
    ["Roofing vacant", payload({ corelogic: { ...payload().corelogic, site_land_use: "Vacant Residential" } }), "vacant_property_classification"],
    ["non-candidate", payload(), null],
  ])("persists one trusted %s observation", async (_caseName, body, category) => {
    const { result, persisted } = await handle(body);

    expect(result).toEqual({ status: 200, body: { outcome: "success" } });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      companyId: COMPANY_ID,
      flowId: "synthetic-roofing-flow",
      channel: "webhook",
      observedAt: "2026-08-12T16:00:00.000Z",
      rows: [{ company_id: COMPANY_ID, flow_id: "synthetic-roofing-flow", reason_category: category }],
    });
  });

  it("persists replays once per delivery while keeping one logical event row", async () => {
    const dependencies = makeDependencies();
    const first = await handle(payload(), dependencies);
    const second = await handle(payload(), dependencies);

    expect(first.result).toEqual({ status: 200, body: { outcome: "success" } });
    expect(second.result).toEqual({ status: 200, body: { outcome: "success" } });
    expect(dependencies.persisted).toHaveLength(2);
    expect(dependencies.rowsByEventId).toHaveLength(1);
  });

  it.each([
    ["multiple-property", { reason: "Incomplete address. Multiple property results returned.", site_land_use: "Single Family" }],
    ["vacant", { reason: "Synthetic reason", site_land_use: "Vacant Residential" }],
  ])("keeps Virtual Quote %s observations as non-candidates", async (_caseName, corelogic) => {
    const dependencies = makeDependencies({
      getBinding: () => binding({
        slug: "roofing-virtual-quote",
        flowId: "synthetic-virtual-quote-flow",
        flowName: "Roofing Virtual Quote",
        tokens: [{ value: "synthetic-virtual-quote-token", validUntil: null }],
      }),
    });
    const result = await handleLeadConduitShadowRequest(
      request(payload({ flow_id: "synthetic-virtual-quote-flow", corelogic: { ...payload().corelogic, ...corelogic } }), {
        authorization: "Bearer synthetic-virtual-quote-token",
      }),
      "roofing-virtual-quote",
      dependencies.deps,
    );

    expect(result).toEqual({ status: 200, body: { outcome: "success" } });
    expect(dependencies.persisted).toHaveLength(1);
    expect(dependencies.persisted[0].rows[0]).toMatchObject({
      flow_id: "synthetic-virtual-quote-flow",
      reason_category: null,
      processing_status: "not_applicable",
      attribution: { shadow_categories: [] },
    });
  });

  it("returns a sanitized retry response when persistence fails", async () => {
    const secret = "synthetic-persistence-error";
    const { deps } = makeDependencies({ persist: async () => { throw new Error(secret); } });
    const result = await handleLeadConduitShadowRequest(
      request(payload(), { authorization: `Bearer ${ACTIVE_TOKEN}` }),
      "roofing",
      deps,
    );

    expect(result).toEqual({ status: 503, body: { outcome: "retry", category: "persistence" } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
