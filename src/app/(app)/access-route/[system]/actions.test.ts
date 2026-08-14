import { describe, expect, it, vi } from "vitest";
import type { JobNimbusCanaryResult } from "@/modules/access-route/jobnimbus-canary";
import type { JobNimbusProbeResult } from "@/modules/access-route/vendors";
import {
  createJobNimbusActionHandlers,
  idleJobNimbusActionState,
} from "./action-handlers";

const successfulProbe = {
  contacts: {
    resource: "contacts",
    ok: true,
    status: 200,
    recordCount: 1,
    fieldNames: ["email", "id"],
  } satisfies JobNimbusProbeResult,
  jobs: {
    resource: "jobs",
    ok: true,
    status: 200,
    recordCount: 1,
    fieldNames: ["id", "status"],
  } satisfies JobNimbusProbeResult,
};

const successfulImport: JobNimbusCanaryResult = {
  outcome: "succeeded",
  contactsSeen: 2,
  contactsWritten: 2,
  jobsSeen: 1,
  jobsWritten: 1,
};

describe("JobNimbus action handlers", () => {
  it("rejects probes while the dedicated canary gate is disabled", async () => {
    const handlers = createJobNimbusActionHandlers({
      isCanaryEnabled: () => false,
      getAdminCompanyId: vi.fn(() => {
        throw new Error("admin lookup must not run");
      }),
      probe: vi.fn(() => {
        throw new Error("vendor request must not run");
      }),
      importSample: vi.fn(),
      revalidate: vi.fn(),
    });

    await expect(
      handlers.testConnection(idleJobNimbusActionState, new FormData()),
    ).resolves.toEqual({
      status: "failed",
      message: "JobNimbus staging canary is disabled.",
    });
  });

  it("rejects imports while the dedicated canary gate is disabled", async () => {
    const handlers = createJobNimbusActionHandlers({
      isCanaryEnabled: () => false,
      getAdminCompanyId: vi.fn(() => {
        throw new Error("admin lookup must not run");
      }),
      probe: vi.fn(),
      importSample: vi.fn(() => {
        throw new Error("vendor request must not run");
      }),
      revalidate: vi.fn(),
    });

    await expect(
      handlers.importSample(idleJobNimbusActionState, new FormData()),
    ).resolves.toEqual({
      status: "failed",
      message: "JobNimbus staging canary is disabled.",
    });
  });

  it("rejects unauthenticated probes before any vendor request", async () => {
    const probe = vi.fn().mockResolvedValue(successfulProbe);
    const handlers = createJobNimbusActionHandlers({
      isCanaryEnabled: () => true,
      getAdminCompanyId: vi.fn().mockResolvedValue(null),
      probe,
      importSample: vi.fn(),
      revalidate: vi.fn(),
    });

    const result = await handlers.testConnection(idleJobNimbusActionState, new FormData());

    expect(result).toEqual({
      status: "failed",
      message: "Administrator access is required.",
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns only the sanitized probe contract", async () => {
    const handlers = createJobNimbusActionHandlers({
      isCanaryEnabled: () => true,
      getAdminCompanyId: vi.fn().mockResolvedValue("company-a"),
      probe: vi.fn().mockResolvedValue(successfulProbe),
      importSample: vi.fn(),
      revalidate: vi.fn(),
    });

    const result = await handlers.testConnection(idleJobNimbusActionState, new FormData());

    expect(result).toEqual({ status: "succeeded", probe: successfulProbe });
    expect(JSON.stringify(result)).not.toContain("person@example.com");
  });

  it("binds sample imports to the authenticated admin company", async () => {
    const importSample = vi.fn().mockResolvedValue(successfulImport);
    const revalidate = vi.fn();
    const handlers = createJobNimbusActionHandlers({
      isCanaryEnabled: () => true,
      getAdminCompanyId: vi.fn().mockResolvedValue("company-a"),
      probe: vi.fn(),
      importSample,
      revalidate,
    });
    const formData = new FormData();
    formData.set("companyId", "company-b");

    const result = await handlers.importSample(idleJobNimbusActionState, formData);

    expect(importSample).toHaveBeenCalledWith("company-a");
    expect(result).toEqual({ status: "succeeded", importResult: successfulImport });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate after a failed canary import", async () => {
    const revalidate = vi.fn();
    const handlers = createJobNimbusActionHandlers({
      isCanaryEnabled: () => true,
      getAdminCompanyId: vi.fn().mockResolvedValue("company-a"),
      probe: vi.fn(),
      importSample: vi.fn().mockResolvedValue({
        ...successfulImport,
        outcome: "failed",
        errorCategory: "authorization",
      }),
      revalidate,
    });

    const result = await handlers.importSample(idleJobNimbusActionState, new FormData());

    expect(result.status).toBe("failed");
    expect(result.message).toBe("JobNimbus import failed: authorization.");
    expect(revalidate).not.toHaveBeenCalled();
  });
});
