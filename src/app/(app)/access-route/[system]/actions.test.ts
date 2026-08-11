import { describe, expect, it, vi } from "vitest";
import type { JobNimbusCanaryResult } from "@/modules/access-route/jobnimbus-canary";
import type { LeadConduitFlowBinding, LeadConduitFlowSlug } from "@/modules/access-route/leadconduit-config";
import type {
  LeadConduitSanitizedProbeResult,
  LeadConduitShadowResult,
} from "@/modules/access-route/leadconduit-shadow-import";
import type { JobNimbusProbeResult } from "@/modules/access-route/vendors";
import {
  createJobNimbusActionHandlers,
  createLeadConduitActionHandlers,
  idleJobNimbusActionState,
  idleLeadConduitActionState,
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
  it("rejects unauthenticated probes before any vendor request", async () => {
    const probe = vi.fn().mockResolvedValue(successfulProbe);
    const handlers = createJobNimbusActionHandlers({
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

const companyId = "10000000-0000-4000-8000-000000000001";

const successfulLeadConduitProbe: LeadConduitSanitizedProbeResult = {
  ok: true,
  status: 200,
  visibleFlowCount: 2,
  approvedFlows: [
    {
      flowName: "Roofing",
      sourceCount: 2,
      fieldNames: ["lead.email", "lead.first_name"],
    },
    {
      flowName: "Roofing Virtual Quote",
      sourceCount: 1,
      fieldNames: ["lead.first_name", "lead.phone_1"],
    },
  ],
  missingFlowNames: [],
};

function leadConduitBinding(
  slug: LeadConduitFlowSlug,
  overrides: Partial<LeadConduitFlowBinding["capabilities"]> = {},
): LeadConduitFlowBinding {
  return {
    slug,
    companyId,
    flowId: slug === "roofing" ? "flow-roofing" : "flow-virtual-quote",
    flowName: slug === "roofing" ? "Roofing" : "Roofing Virtual Quote",
    capabilities: {
      shadowImport: true,
      polling: false,
      receipt: false,
      processing: false,
      rescueRecommendations: false,
      rescueActions: false,
      ...overrides,
    },
    tokens: [],
  };
}

function shadowResult(flowSlug: LeadConduitFlowSlug): LeadConduitShadowResult {
  return {
    outcome: "succeeded",
    flowSlug,
    flowSeen: true,
    sourceMetadataSeen: flowSlug === "roofing" ? 2 : 1,
    eventsSeen: flowSlug === "roofing" ? 11 : 7,
    eventsWritten: flowSlug === "roofing" ? 11 : 7,
    nextCursor: flowSlug === "roofing" ? "event-roofing-11" : "event-quote-7",
  };
}

function leadConduitDependencies(input?: {
  adminCompanyId?: string | null;
  probeEnabled?: boolean;
  binding?: (slug: LeadConduitFlowSlug) => LeadConduitFlowBinding | null;
}) {
  return {
    getAdminCompanyId: vi.fn().mockResolvedValue(
      input && "adminCompanyId" in input ? input.adminCompanyId : companyId,
    ),
    probeEnabled: vi.fn().mockReturnValue(input?.probeEnabled ?? true),
    getBinding: vi.fn().mockImplementation(
      input?.binding ?? ((slug: LeadConduitFlowSlug) => leadConduitBinding(slug)),
    ),
    probe: vi.fn().mockResolvedValue(successfulLeadConduitProbe),
    importShadow: vi.fn().mockImplementation(async (_companyId: string, slug: LeadConduitFlowSlug) => shadowResult(slug)),
    revalidate: vi.fn(),
  };
}

describe("LeadConduit action handlers", () => {
  it("rejects unauthenticated probes before any vendor request", async () => {
    const dependencies = leadConduitDependencies({ adminCompanyId: null });
    const handlers = createLeadConduitActionHandlers(dependencies);

    const result = await handlers.testConnection(idleLeadConduitActionState, new FormData());

    expect(result).toEqual({ status: "failed", message: "Administrator access is required." });
    expect(dependencies.probe).not.toHaveBeenCalled();
  });

  it("denies probes when the standalone server flag is disabled", async () => {
    const dependencies = leadConduitDependencies({ probeEnabled: false });
    const handlers = createLeadConduitActionHandlers(dependencies);

    const result = await handlers.testConnection(idleLeadConduitActionState, new FormData());

    expect(result).toEqual({ status: "failed", message: "LeadConduit connection probe is disabled." });
    expect(dependencies.probe).not.toHaveBeenCalled();
  });

  it("binds the sanitized standalone probe to admin_profiles.company_id", async () => {
    const dependencies = leadConduitDependencies();
    const handlers = createLeadConduitActionHandlers(dependencies);
    const formData = new FormData();
    formData.set("companyId", "attacker-controlled-company");
    formData.set("flowId", "attacker-controlled-flow");

    const result = await handlers.testConnection(idleLeadConduitActionState, formData);

    expect(dependencies.probe).toHaveBeenCalledWith(companyId);
    expect(result).toEqual({ status: "succeeded", probe: successfulLeadConduitProbe });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("flow-roofing");
    expect(serialized).not.toContain("fixture-homeowner@example.invalid");
    expect(serialized).not.toContain("Fixture Homeowner Must Never Render");
  });

  it("denies a selected flow when its per-flow shadow-import flag is disabled", async () => {
    const dependencies = leadConduitDependencies({
      binding: (slug) => leadConduitBinding(slug, { shadowImport: false }),
    });
    const handlers = createLeadConduitActionHandlers(dependencies);
    const formData = new FormData();
    formData.set("flowSlug", "roofing");

    const result = await handlers.importShadow(idleLeadConduitActionState, formData);

    expect(result).toEqual({ status: "failed", message: "Roofing shadow import is disabled." });
    expect(dependencies.importShadow).not.toHaveBeenCalled();
  });

  it.each([
    ["polling", "scheduled polling"],
    ["receipt", "vendor receipt"],
    ["processing", "lead processing"],
    ["rescueRecommendations", "rescue recommendations"],
    ["rescueActions", "rescue actions"],
  ] as const)("keeps %s disabled throughout the manual shadow action", async (capability, _label) => {
    const dependencies = leadConduitDependencies({
      binding: (slug) => leadConduitBinding(slug, { [capability]: true }),
    });
    const handlers = createLeadConduitActionHandlers(dependencies);
    const formData = new FormData();
    formData.set("flowSlug", "roofing");

    const result = await handlers.importShadow(idleLeadConduitActionState, formData);

    expect(result).toEqual({
      status: "failed",
      message: "LeadConduit shadow safety controls must remain disabled.",
    });
    expect(dependencies.importShadow).not.toHaveBeenCalled();
  });

  it.each([
    ["roofing", 11],
    ["roofing-virtual-quote", 7],
  ] as const)("uses the server binding and returns the selected %s event count", async (flowSlug, eventsSeen) => {
    const dependencies = leadConduitDependencies();
    const handlers = createLeadConduitActionHandlers(dependencies);
    const formData = new FormData();
    formData.set("flowSlug", flowSlug);
    formData.set("companyId", "attacker-controlled-company");
    formData.set("flowId", "attacker-controlled-flow");

    const result = await handlers.importShadow(idleLeadConduitActionState, formData);

    expect(dependencies.getBinding).toHaveBeenCalledWith(flowSlug);
    expect(dependencies.importShadow).toHaveBeenCalledWith(companyId, flowSlug);
    expect(result).toEqual({
      status: "succeeded",
      importResult: {
        flowName: flowSlug === "roofing" ? "Roofing" : "Roofing Virtual Quote",
        flowSeen: true,
        sourceMetadataSeen: flowSlug === "roofing" ? 2 : 1,
        eventsSeen,
        eventsWritten: eventsSeen,
      },
    });
    expect(JSON.stringify(result)).not.toContain("event-roofing-11");
    expect(JSON.stringify(result)).not.toContain("event-quote-7");
    expect(dependencies.revalidate).toHaveBeenCalledTimes(1);
  });

  it("rejects a configured flow binding that belongs to another company", async () => {
    const dependencies = leadConduitDependencies({
      binding: (slug) => ({ ...leadConduitBinding(slug), companyId: "other-company" }),
    });
    const handlers = createLeadConduitActionHandlers(dependencies);
    const formData = new FormData();
    formData.set("flowSlug", "roofing");

    const result = await handlers.importShadow(idleLeadConduitActionState, formData);

    expect(result).toEqual({ status: "failed", message: "LeadConduit flow binding is unavailable." });
    expect(dependencies.importShadow).not.toHaveBeenCalled();
  });
});
