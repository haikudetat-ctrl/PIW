import { describe, expect, it, vi } from "vitest";
import { runAccessRouteSync } from "./run";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function repository() {
  return {
    getCompanyId: vi.fn().mockResolvedValue("company-1"),
    getLastCursor: vi.fn().mockResolvedValue(null),
    beginRun: vi.fn().mockResolvedValue({ id: "run-1", duplicate: false }),
    finishRun: vi.fn().mockResolvedValue(undefined),
    upsertLeadConduitFlows: vi.fn().mockResolvedValue(0),
    upsertLeadConduitEvents: vi.fn().mockResolvedValue(0),
    upsertLeadMasterRecords: vi.fn().mockResolvedValue(0),
    upsertLeadMasterCustomFields: vi.fn().mockResolvedValue(0),
    upsertJobNimbusContacts: vi.fn().mockResolvedValue(0),
    upsertJobNimbusJobs: vi.fn().mockResolvedValue(0),
  };
}

function environment(overrides: Record<string, unknown> = {}) {
  return {
    ACCESS_ROUTE_COMPANY_ID: "company-1",
    INTEGRATIONS_LEADCONDUIT_ENABLED: false,
    INTEGRATIONS_LEADMASTER_ENABLED: false,
    INTEGRATIONS_JOBNIMBUS_ENABLED: false,
    LEADCONDUIT_API_KEY: undefined,
    LEADCONDUIT_BASE_URL: undefined,
    LEADMASTER_ACCESS_TOKEN: undefined,
    LEADMASTER_BASE_URL: undefined,
    LEADMASTER_WORKGROUPS: undefined,
    LEADMASTER_LOOKBACK_MINUTES: 60,
    JOBNIMBUS_API_KEY: undefined,
    JOBNIMBUS_BASE_URL: undefined,
    JOBNIMBUS_CONTACTS_PATH: undefined,
    JOBNIMBUS_JOBS_PATH: undefined,
    JOBNIMBUS_INCLUDE_SOLD_VALUE: false,
    JOBNIMBUS_PAGE_LIMIT: 10,
    JOBNIMBUS_MAX_PAGES: 1,
    ...overrides,
  };
}

describe("runAccessRouteSync", () => {
  it("does not schedule legacy LeadConduit alone or perform tenant lookup, fetch, or persistence", async () => {
    const repo = repository();
    const fetcher = vi.fn<typeof fetch>();

    await expect(runAccessRouteSync({
      environment: environment({ INTEGRATIONS_LEADCONDUIT_ENABLED: true, LEADCONDUIT_API_KEY: "legacy-key" }),
      repository: repo,
      fetcher,
    })).resolves.toEqual({ enabled: false, results: [] });

    expect(repo.getCompanyId).not.toHaveBeenCalled();
    expect(repo.getLastCursor).not.toHaveBeenCalled();
    expect(repo.beginRun).not.toHaveBeenCalled();
    expect(repo.finishRun).not.toHaveBeenCalled();
    expect(repo.upsertLeadConduitFlows).not.toHaveBeenCalled();
    expect(repo.upsertLeadConduitEvents).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("continues scheduling configured LeadMaster and JobNimbus reads", async () => {
    const repo = repository();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse([]));

    const result = await runAccessRouteSync({
      environment: environment({
        INTEGRATIONS_LEADMASTER_ENABLED: true,
        LEADMASTER_ACCESS_TOKEN: "leadmaster-key",
        INTEGRATIONS_JOBNIMBUS_ENABLED: true,
        JOBNIMBUS_API_KEY: "jobnimbus-key",
      }),
      repository: repo,
      fetcher,
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result).toEqual({
      enabled: true,
      results: [
        { vendor: "leadmaster", outcome: "succeeded", recordsSeen: 0, recordsWritten: 0 },
        { vendor: "jobnimbus", outcome: "succeeded", recordsSeen: 0, recordsWritten: 0 },
      ],
    });
    expect(repo.getCompanyId).toHaveBeenCalledWith("company-1");
    expect(repo.beginRun.mock.calls.map(([input]) => input.sourceSystem).sort()).toEqual(["jobnimbus", "leadmaster"]);
    expect(repo.upsertLeadMasterRecords).toHaveBeenCalledWith([]);
    expect(repo.upsertLeadMasterCustomFields).toHaveBeenCalledWith([]);
    expect(repo.upsertJobNimbusContacts).toHaveBeenCalledWith([]);
    expect(repo.upsertJobNimbusJobs).toHaveBeenCalledWith([]);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
