// @vitest-environment node
import { describe, expect, it } from "vitest";
import { JobNimbusProviderError } from "@/modules/jobnimbus/client";
import {
  MAX_WRITE_ATTEMPTS,
  processCloseoutWrite,
  type CloseoutWrite,
  type JobNimbusWriter,
  type StatusContext,
  type WritebackDependencies,
} from "./writeback";

type Call = [string, ...unknown[]];

function harness(options: {
  mirrored?: boolean;
  status?: Partial<StatusContext>;
  writer?: Partial<JobNimbusWriter>;
} = {}) {
  const calls: Call[] = [];
  const writer: JobNimbusWriter = {
    requestFileUpload: async (request) => {
      calls.push(["requestFileUpload", request]);
      return { fileJnid: "file-new", uploadUrl: "https://uploads.example.com/x", apiCalls: 1, transientErrorCount: 0, rateLimitResponses: 0 };
    },
    uploadToTicket: async (url, bytes) => {
      calls.push(["uploadToTicket", url, bytes.length]);
      return { apiCalls: 1, transientErrorCount: 0, rateLimitResponses: 0 };
    },
    updateJob: async (jnid, fields) => {
      calls.push(["updateJob", jnid, fields]);
      return { record: { jnid }, apiCalls: 1, transientErrorCount: 0, rateLimitResponses: 0 };
    },
    ...options.writer,
  };
  const dependencies: WritebackDependencies = {
    renderPackage: async (closeoutId) => {
      calls.push(["renderPackage", closeoutId]);
      return { bytes: new Uint8Array([37, 80, 68, 70]), filename: "Closeout package - Job 4512.pdf", jobJnid: "job-1", companyId: "company-1", version: 7 };
    },
    savePackage: async (path) => {
      calls.push(["savePackage", path]);
    },
    isFileMirrored: async () => options.mirrored ?? false,
    recordTicket: async (writeId, ticket) => {
      calls.push(["recordTicket", writeId, ticket.fileJnid]);
    },
    loadStatusContext: async () => ({
      jobJnid: "job-1",
      targetStatus: "Job Completed",
      currentStatus: "Signed Contract",
      currentStage: "sold",
      ...options.status,
    }),
    complete: async (writeId, outcome) => {
      calls.push(["complete", writeId, outcome.status, outcome.detail]);
    },
    reschedule: async (writeId, retry) => {
      calls.push(["reschedule", writeId, retry.notBefore.toISOString(), retry.detail]);
    },
    fail: async (writeId, detail) => {
      calls.push(["fail", writeId, detail]);
    },
    createWriter: async () => writer,
    now: () => new Date("2026-11-20T15:00:00Z"),
  };
  return { calls, dependencies };
}

const attach: CloseoutWrite = {
  id: "write-1",
  companyId: "company-1",
  closeoutId: "closeout-1",
  kind: "attach_package",
  attempts: 1,
  jobnimbusFileJnid: null,
};
const status: CloseoutWrite = { ...attach, id: "write-2", kind: "set_completed_status" };

describe("attaching the package", () => {
  it("renders, keeps a copy, records the ticket before uploading, then completes", async () => {
    const { calls, dependencies } = harness();
    expect(await processCloseoutWrite(attach, dependencies)).toBe("succeeded");
    expect(calls.map((call) => call[0])).toEqual([
      "renderPackage",
      "savePackage",
      "requestFileUpload",
      "recordTicket",
      "uploadToTicket",
      "complete",
    ]);
    expect(calls[1][1]).toBe("company-1/closeout-1/package-v7.pdf");
    expect(calls[2][1]).toMatchObject({ relatedJnids: ["job-1"], type: 1, filename: "Closeout package - Job 4512.pdf" });
  });

  it("does not upload again when an earlier attempt's file already reached JobNimbus", async () => {
    const { calls, dependencies } = harness({ mirrored: true });
    expect(await processCloseoutWrite({ ...attach, jobnimbusFileJnid: "file-old" }, dependencies)).toBe("succeeded");
    expect(calls.map((call) => call[0])).toEqual(["complete"]);
  });

  it("backs off on a transient failure and gives up after the last attempt", async () => {
    const flaky = harness({
      writer: {
        requestFileUpload: async () => {
          throw new JobNimbusProviderError("down", { terminal: false, status: 503, code: "http" });
        },
      },
    });
    expect(await processCloseoutWrite({ ...attach, attempts: 3 }, flaky.dependencies)).toBe("retry");
    expect(flaky.calls.at(-1)).toEqual(["reschedule", "write-1", "2026-11-20T15:08:00.000Z", "JobNimbus returned HTTP 503"]);

    expect(await processCloseoutWrite({ ...attach, attempts: MAX_WRITE_ATTEMPTS }, flaky.dependencies)).toBe("failed");
  });

  it("fails at once, with a useful message, when the API key may not write", async () => {
    const { calls, dependencies } = harness({
      writer: {
        requestFileUpload: async () => {
          throw new JobNimbusProviderError("forbidden", { terminal: true, status: 403, code: "http" });
        },
      },
    });
    expect(await processCloseoutWrite(attach, dependencies)).toBe("failed");
    expect(calls.at(-1)).toEqual([
      "fail",
      "write-1",
      "JobNimbus refused the write (HTTP 403). Check that the API key can edit jobs and files.",
    ]);
  });
});

describe("setting the completed status", () => {
  it("moves the job to the company's completed status", async () => {
    const { calls, dependencies } = harness();
    expect(await processCloseoutWrite(status, dependencies)).toBe("succeeded");
    expect(calls[0]).toEqual(["updateJob", "job-1", { status_name: "Job Completed" }]);
    expect(calls[1]).toEqual(["complete", "write-2", "succeeded", "Moved from Signed Contract to Job Completed"]);
  });

  it("leaves a job JobNimbus already counts as completed", async () => {
    const { calls, dependencies } = harness({ status: { currentStatus: "Pending Payments", currentStage: "completed" } });
    expect(await processCloseoutWrite(status, dependencies)).toBe("skipped");
    expect(calls).toEqual([["complete", "write-2", "skipped", "JobNimbus already shows Pending Payments"]]);
  });

  it("refuses to complete a job marked lost", async () => {
    const { calls, dependencies } = harness({ status: { currentStatus: "Lost", currentStage: "lost" } });
    expect(await processCloseoutWrite(status, dependencies)).toBe("failed");
    expect(calls.map((call) => call[0])).toEqual(["fail"]);
  });
});
