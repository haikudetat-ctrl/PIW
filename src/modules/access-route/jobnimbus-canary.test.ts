import { describe, expect, it, vi } from "vitest";
import type { AccessRouteRepository } from "./contracts";
import {
  importJobNimbusCanary,
  type JobNimbusEnvironment,
} from "./jobnimbus-canary";

const companyId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-10T17:00:00.000Z");

const environment: JobNimbusEnvironment = {
  INTEGRATIONS_JOBNIMBUS_ENABLED: false,
  JOBNIMBUS_API_KEY: "server-only-key",
  JOBNIMBUS_BASE_URL: "https://app.jobnimbus.com",
  JOBNIMBUS_CONTACTS_PATH: "/api1/contacts",
  JOBNIMBUS_JOBS_PATH: "/api1/jobs",
  JOBNIMBUS_INCLUDE_SOLD_VALUE: false,
  JOBNIMBUS_PAGE_LIMIT: 2,
  JOBNIMBUS_MAX_PAGES: 1,
};

function repository() {
  return {
    getCompanyId: vi.fn(),
    getLastCursor: vi.fn(),
    beginRun: vi.fn().mockResolvedValue({ id: "run-1", duplicate: false }),
    finishRun: vi.fn().mockResolvedValue(undefined),
    upsertLeadConduitFlows: vi.fn(),
    upsertLeadConduitEvents: vi.fn(),
    upsertLeadMasterRecords: vi.fn(),
    upsertLeadMasterCustomFields: vi.fn(),
    upsertJobNimbusContacts: vi.fn().mockImplementation(async (rows) => rows.length),
    upsertJobNimbusJobs: vi.fn().mockImplementation(async (rows) => rows.length),
  } satisfies AccessRouteRepository;
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("importJobNimbusCanary", () => {
  it("records a failed run without persistence when either resource probe fails", async () => {
    const store = repository();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      return url.pathname.includes("contacts")
        ? jsonResponse([], 403)
        : jsonResponse([{ id: "job-probe" }]);
    });

    const result = await importJobNimbusCanary({
      companyId,
      environment,
      repository: store,
      fetcher,
      now,
    });

    expect(result).toEqual({
      outcome: "failed",
      contactsSeen: 0,
      contactsWritten: 0,
      jobsSeen: 0,
      jobsWritten: 0,
      errorCategory: "authorization",
    });
    expect(store.upsertJobNimbusContacts).not.toHaveBeenCalled();
    expect(store.upsertJobNimbusJobs).not.toHaveBeenCalled();
    expect(store.finishRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      outcome: "failed",
      errorCategory: "authorization",
      metadata: { mode: "canary", read_only: true },
    }));
  });

  it("imports a tenant-bound capped sample while scheduled ingestion is disabled", async () => {
    const store = repository();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const isProbe = url.searchParams.get("size") === "1";
      if (url.pathname.includes("contacts")) {
        return jsonResponse(isProbe
          ? [{ id: "contact-probe", email: "hidden@example.com" }]
          : [
              { id: "contact-1", email: "one@example.com" },
              { id: "contact-2", email: "two@example.com" },
            ]);
      }
      return jsonResponse(isProbe
        ? [{ id: "job-probe", status: "Open" }]
        : [{ id: "job-1", contact_id: "contact-1", sold_value: 9999 }]);
    });

    const result = await importJobNimbusCanary({
      companyId,
      environment,
      repository: store,
      fetcher,
      now,
    });

    expect(environment.INTEGRATIONS_JOBNIMBUS_ENABLED).toBe(false);
    expect(result).toEqual({
      outcome: "succeeded",
      contactsSeen: 2,
      contactsWritten: 2,
      jobsSeen: 1,
      jobsWritten: 1,
    });
    expect(store.beginRun).toHaveBeenCalledWith({
      companyId,
      sourceSystem: "jobnimbus",
      syncKey: "jobnimbus:canary:2026-08-10T17:00:00.000Z",
    });
    expect(store.upsertJobNimbusContacts).toHaveBeenCalledWith([
      expect.objectContaining({ company_id: companyId, contact_id: "contact-1" }),
      expect.objectContaining({ company_id: companyId, contact_id: "contact-2" }),
    ]);
    expect(store.upsertJobNimbusJobs).toHaveBeenCalledWith([
      expect.objectContaining({ company_id: companyId, job_id: "job-1", sold_value: null }),
    ]);
    expect(store.finishRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      outcome: "succeeded",
      recordsSeen: 3,
      recordsWritten: 3,
      metadata: {
        mode: "canary",
        read_only: true,
        contact_count: 2,
        job_count: 1,
      },
    }));
    const importUrls = fetcher.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.searchParams.get("size") !== "1");
    expect(importUrls).toHaveLength(2);
    expect(importUrls.every((url) => url.searchParams.get("size") === "2")).toBe(true);
    expect(importUrls.every((url) => url.searchParams.get("from") === "0")).toBe(true);
  });
});
