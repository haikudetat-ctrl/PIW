// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { JobNimbusProviderError, type JobNimbusRecord, type JobNimbusScanResult } from "./client";
import {
  JobNimbusReconcileMismatchError,
  formatSyncError,
  hashJobNimbusPayload,
  resolveJobNimbusCredential,
  runJobNimbusSync,
  type JobNimbusRunFinish,
  type JobNimbusSyncClient,
  type JobNimbusSyncDependencies,
  type JobNimbusSyncStore,
} from "./sync";

const COMPANY = "95000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-29T12:00:00Z");

function scan(records: JobNimbusRecord[], unfilteredCount = records.length): JobNimbusScanResult {
  return { records, unfilteredCount, apiCalls: 2, transientErrorCount: 1, rateLimitResponses: 1 };
}

function harness(options: {
  state?: { watermark: string; lastFullAt: string | null } | null;
  client?: Partial<JobNimbusSyncClient>;
  credential?: string | undefined;
} = {}) {
  const finishes: JobNimbusRunFinish[] = [];
  const landed: Array<{ jnids: string[]; watermark: string }> = [];
  const store: JobNimbusSyncStore = {
    getEnabledIntegration: vi.fn(async () => ({
      envKeyName: "JOBNIMBUS_API_KEY",
      historyStart: "2020-01-01T00:00:00.000Z",
    })),
    getSyncState: vi.fn(async () => options.state ?? null),
    createRun: vi.fn(async () => "run-1"),
    landBatch: vi.fn(async (input: Parameters<JobNimbusSyncStore["landBatch"]>[0]) => {
      landed.push({ jnids: input.records.map((record) => record.jnid), watermark: input.watermark });
      return input.records.length;
    }),
    finishRun: vi.fn(async (_runId: string, finish: JobNimbusRunFinish) => {
      finishes.push(finish);
    }),
    markLastFull: vi.fn(async () => {}),
  };
  const client: JobNimbusSyncClient = {
    verifyFutureCutoff: vi.fn(async () => ({
      verified: true as const, unfilteredCount: 0, apiCalls: 1, transientErrorCount: 0, rateLimitResponses: 0,
    })),
    incrementalScan: vi.fn(async () => scan([])),
    fullScan: vi.fn(async () => scan([])),
    ...options.client,
  };
  const dependencies: JobNimbusSyncDependencies = {
    store,
    createClient: vi.fn(() => client),
    resolveCredential: vi.fn(() => ("credential" in options ? options.credential : "secret")),
    now: () => NOW,
  };
  return { dependencies, store, client, finishes, landed };
}

describe("runJobNimbusSync", () => {
  it("full-scans the configured history window and lands every record", async () => {
    const records = [
      { jnid: "a", date_updated: 1_758_000_000 },
      { jnid: "b", date_updated: 1_758_000_100 },
    ];
    const { dependencies, client, finishes, landed, store } = harness({
      client: { fullScan: vi.fn(async () => scan(records)) },
    });

    const result = await runJobNimbusSync(
      { companyId: COMPANY, recordType: "job", mode: "full" },
      dependencies,
    );

    expect(client.fullScan).toHaveBeenCalledWith("job", {
      windowStart: new Date("2020-01-01T00:00:00.000Z"),
      windowEnd: NOW,
    });
    expect(landed).toEqual([{ jnids: ["a", "b"], watermark: NOW.toISOString() }]);
    expect(result).toMatchObject({ mode: "full", recordsSeen: 2, recordsChanged: 2 });
    expect(finishes[0]).toMatchObject({ status: "ok", recordsSeen: 2, apiCalls: 2, rateLimitErrorCount: 1 });
    expect(store.markLastFull).toHaveBeenCalledWith({
      companyId: COMPANY, recordType: "job", watermark: NOW.toISOString(),
    });
  });

  it("verifies the filter and re-reads a 48-hour overlap on incremental runs", async () => {
    const { dependencies, client, store } = harness({
      state: { watermark: "2026-09-29T10:00:00.000Z", lastFullAt: "2026-09-29T00:00:00.000Z" },
    });

    await runJobNimbusSync({ companyId: COMPANY, recordType: "contact", mode: "incremental" }, dependencies);

    expect(client.verifyFutureCutoff).toHaveBeenCalledWith("contact");
    expect(client.incrementalScan).toHaveBeenCalledWith("contact", new Date("2026-09-27T10:00:00.000Z"));
    expect(store.markLastFull).not.toHaveBeenCalled();
  });

  it("still advances the watermark when an incremental scan finds nothing", async () => {
    const { dependencies, landed } = harness({
      state: { watermark: "2026-09-29T10:00:00.000Z", lastFullAt: "2026-09-29T00:00:00.000Z" },
    });

    await runJobNimbusSync({ companyId: COMPANY, recordType: "job", mode: "incremental" }, dependencies);

    expect(landed).toEqual([{ jnids: [], watermark: NOW.toISOString() }]);
  });

  it("refuses an incremental run without a watermark", async () => {
    const { dependencies, store } = harness({ state: null });

    await expect(
      runJobNimbusSync({ companyId: COMPANY, recordType: "job", mode: "incremental" }, dependencies),
    ).rejects.toThrow("requires an existing watermark");
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it("marks a full scan whose count disagrees with JobNimbus as a reconcile mismatch", async () => {
    const { dependencies, finishes, landed, store } = harness({
      client: { fullScan: vi.fn(async () => scan([{ jnid: "a" }], 2)) },
    });

    await expect(
      runJobNimbusSync({ companyId: COMPANY, recordType: "job", mode: "full" }, dependencies),
    ).rejects.toBeInstanceOf(JobNimbusReconcileMismatchError);
    expect(finishes[0].status).toBe("reconcile_mismatch");
    expect(landed).toEqual([]);
    expect(store.markLastFull).not.toHaveBeenCalled();
  });

  it("records provider failures with a sanitized category and their telemetry", async () => {
    const failure = new JobNimbusProviderError("JobNimbus request failed with HTTP 401", {
      terminal: true,
      status: 401,
      code: "http",
      telemetry: { apiCalls: 1, transientErrorCount: 0, rateLimitResponses: 0 },
    });
    const { dependencies, finishes } = harness({
      client: { fullScan: vi.fn(async () => { throw failure; }) },
    });

    await expect(
      runJobNimbusSync({ companyId: COMPANY, recordType: "job", mode: "full" }, dependencies),
    ).rejects.toBe(failure);
    expect(finishes[0]).toMatchObject({
      status: "failed", apiCalls: 1, error: "JobNimbus http error (HTTP 401)",
    });
  });

  it("fails the run without calling JobNimbus when the credential is missing", async () => {
    const { dependencies, finishes } = harness({ credential: undefined });

    await expect(
      runJobNimbusSync({ companyId: COMPANY, recordType: "job", mode: "full" }, dependencies),
    ).rejects.toThrow("credential is not configured");
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(finishes[0]).toMatchObject({ status: "failed", error: "JobNimbus sync failed (internal error)" });
  });

  it("lands large scans in bounded batches", async () => {
    const records = Array.from({ length: 5 }, (_, index) => ({ jnid: `r${index}` }));
    const { dependencies, landed } = harness({
      client: { fullScan: vi.fn(async () => scan(records)) },
    });

    await runJobNimbusSync({ companyId: COMPANY, recordType: "job", mode: "full", batchSize: 2 }, dependencies);

    expect(landed.map((batch) => batch.jnids)).toEqual([["r0", "r1"], ["r2", "r3"], ["r4"]]);
  });
});

describe("hashJobNimbusPayload", () => {
  it("ignores key order and date_updated so a bare touch is not a change", () => {
    expect(hashJobNimbusPayload({ jnid: "a", status_name: "Lead", date_updated: 1 }))
      .toBe(hashJobNimbusPayload({ date_updated: 2, status_name: "Lead", jnid: "a" }));
  });

  it("changes when content changes", () => {
    expect(hashJobNimbusPayload({ jnid: "a", status_name: "Lead" }))
      .not.toBe(hashJobNimbusPayload({ jnid: "a", status_name: "Quoted" }));
  });
});

describe("resolveJobNimbusCredential", () => {
  it("reads only JobNimbus key names from the environment", () => {
    const environment = {
      JOBNIMBUS_API_KEY: "jn",
      JOBNIMBUS_API_KEY_ALLSEASON: "jn-all-season",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    };

    expect(resolveJobNimbusCredential("JOBNIMBUS_API_KEY", environment)).toBe("jn");
    expect(resolveJobNimbusCredential("JOBNIMBUS_API_KEY_ALLSEASON", environment)).toBe("jn-all-season");
    expect(resolveJobNimbusCredential("SUPABASE_SERVICE_ROLE_KEY", environment)).toBeUndefined();
  });
});

describe("formatSyncError", () => {
  it("never includes an arbitrary error message", () => {
    expect(formatSyncError(new Error("token abc123 rejected for jane@example.com")))
      .toBe("JobNimbus sync failed (internal error)");
  });
});
