import { describe, expect, it, vi } from "vitest";
import type { AccessRouteRepository } from "./contracts";
import type { LeadConduitReadEnvironment } from "./leadconduit-config";
import {
  importLeadConduitShadow,
  leadConduitProbeFromMetadata,
  probeLeadConduitConnection,
} from "./leadconduit-shadow-import";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-11T18:00:00.000Z");

const environment: LeadConduitReadEnvironment = {
  ACCESS_ROUTE_COMPANY_ID: COMPANY_ID,
  LEADCONDUIT_API_KEY: "server-only-api-key",
  LEADCONDUIT_BASE_URL: "https://app.leadconduit.com",
  LEADCONDUIT_ROOFING_FLOW_ID: "flow-roofing",
  LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID: "flow-virtual-quote",
  LEADCONDUIT_SHADOW_PAGE_LIMIT: 50,
  LEADCONDUIT_SHADOW_MAX_PAGES: 1,
  LEADCONDUIT_PAGE_LIMIT: 1000,
  LEADCONDUIT_MAX_PAGES: 25,
  LEADCONDUIT_INITIAL_LOOKBACK_MINUTES: 1440,
};

const flows = [
  {
    id: "flow-roofing",
    name: "Roofing",
    enabled: true,
    fields: ["lead.first_name", "lead.email"],
    sources: [{ id: "source-roofing" }],
    destinations: [{ id: "destination-roofing" }],
    acceptance: {
      rules: [{
        id: "rule-roofing-flow",
        name: "Synthetic Roofing Flow Acceptance",
        lhv: "lead.state",
        op: "is equal to",
      }],
    },
    steps: [{
      id: "step-roofing-filter",
      type: "filter",
      name: "Synthetic Roofing Filter",
      order: 3,
      enabled: true,
      outcome: "continue",
      rules: [{
        id: "rule-roofing-filter",
        name: "Synthetic Roofing Filter Rule",
        lhv: "lead.postal_code",
        op: "is included in",
      }],
    }],
  },
  {
    id: "flow-virtual-quote",
    name: "Roofing Virtual Quote",
    enabled: true,
    fields: ["lead.first_name", "lead.phone_1"],
    sources: [{ id: "source-virtual-quote" }],
    destinations: [{ id: "destination-virtual-quote" }],
    acceptance: { rules: [] },
    steps: [],
  },
  {
    id: "unapproved-flow",
    name: "Unapproved client flow name",
    enabled: true,
    fields: ["private.customer.value"],
    sources: [{ id: "unapproved-source" }],
    steps: [],
  },
];

const sourceMetadata: Record<string, Record<string, unknown>> = {
  "source-roofing": {
    name: "Synthetic Roofing Source",
    fields: [{ name: "lead.email" }, { name: "lead.first_name" }],
    acceptance: {
      rules: [{
        id: "rule-roofing-source",
        name: "Synthetic Roofing Source Acceptance",
        lhv: "lead.email",
        op: "is present",
      }],
    },
    lead: {
      name: "Fixture Homeowner Must Never Render",
      email: "fixture-homeowner@example.invalid",
      phone: "+1-202-555-0107",
      address: "77 Fixture Lane",
    },
  },
  "source-virtual-quote": {
    name: "Synthetic Virtual Quote Source",
    fields: [{ name: "lead.first_name" }, { name: "lead.phone_1" }],
    acceptance: { rules: [] },
  },
};

const eventsByFlow: Record<string, Array<Record<string, unknown>>> = {
  "flow-roofing": [{
    id: "event-roofing-1",
    flow_id: "flow-roofing",
    source_id: "source-roofing",
    type: "source",
    outcome: "success",
    start_timestamp: "2026-08-11T17:55:00.000Z",
    vars: {
      "flow.id": "flow-roofing",
      "source.id": "source-roofing",
      "lead.id": "lead-roofing-1",
      "lead.first_name": "Fixture Homeowner Must Never Render",
      "lead.email": "fixture-homeowner@example.invalid",
      "lead.address": "77 Fixture Lane",
    },
  }],
  "flow-virtual-quote": [{
    id: "event-virtual-quote-1",
    flow_id: "flow-virtual-quote",
    source_id: "source-virtual-quote",
    type: "source",
    outcome: "success",
    start_timestamp: "2026-08-11T17:56:00.000Z",
    vars: {
      "flow.id": "flow-virtual-quote",
      "source.id": "source-virtual-quote",
      "lead.id": "lead-virtual-quote-1",
      "lead.first_name": "Synthetic Quote Homeowner",
    },
  }],
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function vendorFetcher(inputEvents = eventsByFlow) {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/flows") return jsonResponse(flows);
    if (url.pathname === "/events") {
      const rules = JSON.parse(url.searchParams.get("rules") ?? "[]") as Array<{ rhv?: string }>;
      return jsonResponse(inputEvents[rules[0]?.rhv ?? ""] ?? []);
    }
    const sourceMatch = url.pathname.match(/^\/flows\/([^/]+)\/sources\/([^/]+)\/meta$/);
    if (sourceMatch) {
      return jsonResponse(sourceMetadata[decodeURIComponent(sourceMatch[2])] ?? { fields: [] });
    }
    return jsonResponse({ error: "unexpected synthetic path" }, 404);
  });
}

function repository() {
  return {
    getCompanyId: vi.fn(),
    getLastCursor: vi.fn(),
    beginRun: vi.fn().mockResolvedValue({ id: "run-1", duplicate: false }),
    finishRun: vi.fn().mockResolvedValue(undefined),
    upsertLeadConduitFlows: vi.fn().mockImplementation(async ({ rows }) => rows.length),
    upsertLeadConduitEvents: vi.fn().mockImplementation(async ({ rows }) => rows.length),
    upsertLeadConduitSourceMetadata: vi.fn().mockImplementation(async ({ rows }) => rows.length),
    upsertLeadConduitFlowSteps: vi.fn().mockImplementation(async ({ rows }) => rows.length),
    upsertLeadConduitFlowRules: vi.fn().mockImplementation(async ({ rows }) => rows.length),
    upsertLeadMasterRecords: vi.fn(),
    upsertLeadMasterCustomFields: vi.fn(),
    upsertJobNimbusContacts: vi.fn(),
    upsertJobNimbusJobs: vi.fn(),
  } satisfies AccessRouteRepository;
}

describe("probeLeadConduitConnection", () => {
  it("persists and returns only sanitized status, counts, approved names, and field-name lists", async () => {
    const store = repository();
    const result = await probeLeadConduitConnection({
      companyId: COMPANY_ID,
      environment,
      repository: store,
      fetcher: vendorFetcher(),
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      visibleFlowCount: 3,
      approvedFlows: [
        {
          flowName: "Roofing",
          sourceCount: 1,
          fieldNames: ["lead.email", "lead.first_name"],
        },
        {
          flowName: "Roofing Virtual Quote",
          sourceCount: 1,
          fieldNames: ["lead.first_name", "lead.phone_1"],
        },
      ],
      missingFlowNames: [],
    });
    expect(store.beginRun).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      sourceSystem: "leadconduit",
      syncKey: "leadconduit:probe:2026-08-11T18:00:00.000Z",
    });
    expect(store.finishRun).toHaveBeenCalledWith({
      runId: "run-1",
      outcome: "succeeded",
      recordsSeen: 3,
      recordsWritten: 0,
      metadata: {
        status: 200,
        visible_flow_count: 3,
        approved_flows: [
          {
            flow_name: "Roofing",
            source_count: 1,
            field_names: ["lead.email", "lead.first_name"],
          },
          {
            flow_name: "Roofing Virtual Quote",
            source_count: 1,
            field_names: ["lead.first_name", "lead.phone_1"],
          },
        ],
        missing_flow_names: [],
      },
    });
    const serialized = JSON.stringify({ result, finish: store.finishRun.mock.calls });
    for (const privateValue of [
      "flow-roofing",
      "source-roofing",
      "Fixture Homeowner Must Never Render",
      "fixture-homeowner@example.invalid",
      "77 Fixture Lane",
      "Unapproved client flow name",
    ]) expect(serialized).not.toContain(privateValue);
  });

  it("keeps failure output to the sanitized display contract while recording the error category separately", async () => {
    const store = repository();
    const result = await probeLeadConduitConnection({
      companyId: COMPANY_ID,
      environment,
      repository: store,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        email: "fixture-homeowner@example.invalid",
        authorization: "server-only-api-key",
      }, 401)),
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      status: 401,
      visibleFlowCount: 0,
      approvedFlows: [],
      missingFlowNames: ["Roofing", "Roofing Virtual Quote"],
    });
    expect(store.finishRun).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      errorCategory: "authentication",
      metadata: {
        status: 401,
        visible_flow_count: 0,
        approved_flows: [],
        missing_flow_names: ["Roofing", "Roofing Virtual Quote"],
      },
    }));
    expect(JSON.stringify(result)).not.toContain("fixture-homeowner@example.invalid");
    expect(JSON.stringify(result)).not.toContain("server-only-api-key");
  });

  it("rehydrates only allowlisted probe display fields from persisted metadata", () => {
    expect(leadConduitProbeFromMetadata({
      status: 200,
      visible_flow_count: 3,
      approved_flows: [{
        flow_name: "Roofing",
        source_count: 1,
        field_names: ["lead.email"],
        flow_id: "flow-roofing-must-not-enter-state",
        homeowner: "Fixture Homeowner Must Never Render",
      }, {
        flow_name: "Roofing Virtual Quote",
        source_count: 1,
        field_names: ["lead.phone_1"],
      }],
      missing_flow_names: [],
      raw_payload: { email: "fixture-homeowner@example.invalid" },
    })).toEqual({
      ok: true,
      status: 200,
      visibleFlowCount: 3,
      approvedFlows: [
        { flowName: "Roofing", sourceCount: 1, fieldNames: ["lead.email"] },
        { flowName: "Roofing Virtual Quote", sourceCount: 1, fieldNames: ["lead.phone_1"] },
      ],
      missingFlowNames: [],
    });
    expect(leadConduitProbeFromMetadata({ status: "200" })).toBeNull();
  });
});

describe("importLeadConduitShadow", () => {
  it.each([
    ["roofing", "flow-roofing", "event-roofing-1", "source-roofing", 3],
    ["roofing-virtual-quote", "flow-virtual-quote", "event-virtual-quote-1", "source-virtual-quote", 0],
  ] as const)("imports only the approved %s flow with exact normalized policy identity", async (
    flowSlug,
    flowId,
    eventId,
    sourceId,
    expectedRules,
  ) => {
    const store = repository();
    const fetcher = vendorFetcher();

    const result = await importLeadConduitShadow({
      companyId: COMPANY_ID,
      flowSlug,
      environment,
      repository: store,
      fetcher,
      now: NOW,
    });

    expect(result).toEqual({
      outcome: "succeeded",
      flowSlug,
      flowSeen: true,
      sourceMetadataSeen: 1,
      eventsSeen: 1,
      eventsWritten: 1,
      nextCursor: eventId,
    });
    expect(store.upsertLeadConduitFlows).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      flowId,
      rows: [expect.objectContaining({ company_id: COMPANY_ID, flow_id: flowId })],
    });
    expect(store.upsertLeadConduitSourceMetadata).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      flowId,
      rows: [expect.objectContaining({
        company_id: COMPANY_ID,
        flow_id: flowId,
        source_id: sourceId,
      })],
    });
    expect(store.upsertLeadConduitEvents).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      flowId,
      channel: "poll",
      observedAt: NOW.toISOString(),
      rows: [expect.objectContaining({ event_id: eventId, flow_id: flowId })],
    });
    expect(store.upsertLeadConduitFlowRules).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      flowId,
      rows: expectedRules ? expect.arrayContaining([
        expect.objectContaining({
          rule_id: "rule-roofing-flow",
          rule_scope: "flow_acceptance",
          rule_scope_id: "flow-roofing",
        }),
        expect.objectContaining({
          rule_id: "rule-roofing-source",
          rule_scope: "source_acceptance",
          rule_scope_id: "source-roofing",
        }),
        expect.objectContaining({
          rule_id: "rule-roofing-filter",
          rule_scope: "filter_step",
          rule_scope_id: "step-roofing-filter",
        }),
      ]) : [],
    });
    if (flowSlug === "roofing") {
      expect(store.upsertLeadConduitFlowSteps).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        flowId,
        rows: [expect.objectContaining({ step_id: "step-roofing-filter", step_order: 3 })],
      });
    }
    expect(store.finishRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      outcome: "succeeded",
      nextCursor: eventId,
      metadata: { mode: "shadow", read_only: true, flow_slug: flowSlug },
    }));
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    const eventsRequests = fetcher.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/events");
    expect(eventsRequests).toHaveLength(1);
    const eventUrl = new URL(String(eventsRequests[0][0]));
    expect(eventUrl.searchParams.get("rules")).toBe(JSON.stringify([
      { lhv: "flow.id", op: "is equal to", rhv: flowId },
    ]));
    expect(eventUrl.searchParams.get("limit")).toBe("50");
    expect(eventUrl.searchParams.get("start")).toBe("2026-08-10T18:00:00.000Z");
  });

  it("never exceeds the 50-event one-page shadow cap even with polling set to 1000 events and 25 pages", async () => {
    const store = repository();
    const fetcher = vendorFetcher({
      ...eventsByFlow,
      "flow-roofing": Array.from({ length: 75 }, (_, index) => ({
        id: `event-roofing-${index + 1}`,
        flow_id: "flow-roofing",
        source_id: "source-roofing",
        type: "source",
      })),
    });

    const result = await importLeadConduitShadow({
      companyId: COMPANY_ID,
      flowSlug: "roofing",
      environment: {
        ...environment,
        LEADCONDUIT_SHADOW_PAGE_LIMIT: 500,
        LEADCONDUIT_SHADOW_MAX_PAGES: 25,
      },
      repository: store,
      fetcher,
      now: NOW,
    });

    expect(result.eventsSeen).toBe(50);
    expect(result.eventsWritten).toBe(50);
    expect(result.nextCursor).toBe("event-roofing-50");
    const eventBatch = store.upsertLeadConduitEvents.mock.calls[0][0];
    expect(eventBatch.rows).toHaveLength(50);
    const eventsRequests = fetcher.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/events");
    expect(eventsRequests).toHaveLength(1);
    expect(new URL(String(eventsRequests[0][0])).searchParams.get("limit")).toBe("50");
  });

  it("does not persist flow data or events when the two-flow probe fails", async () => {
    const store = repository();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ private: "fixture-homeowner@example.invalid" }, 403));

    const result = await importLeadConduitShadow({
      companyId: COMPANY_ID,
      flowSlug: "roofing",
      environment,
      repository: store,
      fetcher,
      now: NOW,
    });

    expect(result).toEqual({
      outcome: "failed",
      flowSlug: "roofing",
      flowSeen: false,
      sourceMetadataSeen: 0,
      eventsSeen: 0,
      eventsWritten: 0,
      nextCursor: null,
      errorCategory: "authorization",
    });
    expect(store.upsertLeadConduitFlows).not.toHaveBeenCalled();
    expect(store.upsertLeadConduitSourceMetadata).not.toHaveBeenCalled();
    expect(store.upsertLeadConduitFlowSteps).not.toHaveBeenCalled();
    expect(store.upsertLeadConduitFlowRules).not.toHaveBeenCalled();
    expect(store.upsertLeadConduitEvents).not.toHaveBeenCalled();
  });

  it("rejects an unexpected-flow event row before any shadow rows are persisted", async () => {
    const store = repository();
    const fetcher = vendorFetcher({
      ...eventsByFlow,
      "flow-roofing": [{
        id: "event-untrusted",
        flow_id: "unapproved-flow",
        type: "source",
      }],
    });

    const result = await importLeadConduitShadow({
      companyId: COMPANY_ID,
      flowSlug: "roofing",
      environment,
      repository: store,
      fetcher,
      now: NOW,
    });

    expect(result).toMatchObject({
      outcome: "failed",
      flowSlug: "roofing",
      errorCategory: "invalid_response",
    });
    expect(store.upsertLeadConduitFlows).not.toHaveBeenCalled();
    expect(store.upsertLeadConduitSourceMetadata).not.toHaveBeenCalled();
    expect(store.upsertLeadConduitFlowSteps).not.toHaveBeenCalled();
    expect(store.upsertLeadConduitFlowRules).not.toHaveBeenCalled();
    expect(store.upsertLeadConduitEvents).not.toHaveBeenCalled();
  });
});
