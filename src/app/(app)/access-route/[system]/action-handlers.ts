import type {
  JobNimbusCanaryResult,
} from "@/modules/access-route/jobnimbus-canary";
import type {
  LeadConduitFlowBinding,
  LeadConduitFlowSlug,
} from "@/modules/access-route/leadconduit-config";
import type {
  LeadConduitSanitizedProbeResult,
  LeadConduitShadowResult,
} from "@/modules/access-route/leadconduit-shadow-import";
import type { JobNimbusProbeResult } from "@/modules/access-route/vendors";

export type JobNimbusProbe = {
  contacts: JobNimbusProbeResult;
  jobs: JobNimbusProbeResult;
};

export type JobNimbusActionState = {
  status: "idle" | "succeeded" | "failed";
  probe?: JobNimbusProbe;
  importResult?: JobNimbusCanaryResult;
  message?: string;
};

export const idleJobNimbusActionState: JobNimbusActionState = { status: "idle" };

type JobNimbusActionDependencies = {
  getAdminCompanyId: () => Promise<string | null>;
  probe: () => Promise<JobNimbusProbe>;
  importSample: (companyId: string) => Promise<JobNimbusCanaryResult>;
  revalidate: () => void;
};

export function createJobNimbusActionHandlers(dependencies: JobNimbusActionDependencies) {
  async function requireCompanyId(): Promise<string | null> {
    return dependencies.getAdminCompanyId();
  }

  return {
    async testConnection(
      previous: JobNimbusActionState,
      formData: FormData,
    ): Promise<JobNimbusActionState> {
      void previous;
      void formData;
      const companyId = await requireCompanyId();
      if (!companyId) {
        return { status: "failed", message: "Administrator access is required." };
      }
      try {
        return { status: "succeeded", probe: await dependencies.probe() };
      } catch {
        return { status: "failed", message: "JobNimbus connection test could not run." };
      }
    },

    async importSample(
      previous: JobNimbusActionState,
      formData: FormData,
    ): Promise<JobNimbusActionState> {
      void previous;
      void formData;
      const companyId = await requireCompanyId();
      if (!companyId) {
        return { status: "failed", message: "Administrator access is required." };
      }
      try {
        const importResult = await dependencies.importSample(companyId);
        if (importResult.outcome === "failed") {
          return {
            status: "failed",
            importResult,
            message: `JobNimbus import failed: ${importResult.errorCategory ?? "upstream"}.`,
          };
        }
        dependencies.revalidate();
        return { status: "succeeded", importResult };
      } catch {
        return { status: "failed", message: "JobNimbus import could not run." };
      }
    },
  };
}

export type LeadConduitActionState = {
  status: "idle" | "succeeded" | "failed";
  probe?: LeadConduitSanitizedProbeResult;
  importResult?: {
    flowName: LeadConduitFlowBinding["flowName"];
    flowSeen: boolean;
    sourceMetadataSeen: number;
    eventsSeen: number;
    eventsWritten: number;
  };
  message?: string;
};

export const idleLeadConduitActionState: LeadConduitActionState = { status: "idle" };

type LeadConduitActionDependencies = {
  getAdminCompanyId: () => Promise<string | null>;
  probeEnabled: () => boolean;
  getBinding: (slug: LeadConduitFlowSlug) => LeadConduitFlowBinding | null;
  probe: (companyId: string) => Promise<LeadConduitSanitizedProbeResult>;
  importShadow: (
    companyId: string,
    flowSlug: LeadConduitFlowSlug,
  ) => Promise<LeadConduitShadowResult>;
  revalidate: () => void;
};

function flowSlugFrom(formData: FormData): LeadConduitFlowSlug | null {
  const value = formData.get("flowSlug");
  return value === "roofing" || value === "roofing-virtual-quote" ? value : null;
}

function shadowSafetyControlsAreDisabled(binding: LeadConduitFlowBinding): boolean {
  return !binding.capabilities.polling
    && !binding.capabilities.receipt
    && !binding.capabilities.processing
    && !binding.capabilities.rescueRecommendations
    && !binding.capabilities.rescueActions;
}

function sanitizedShadowResult(
  flowName: LeadConduitFlowBinding["flowName"],
  result: LeadConduitShadowResult,
): NonNullable<LeadConduitActionState["importResult"]> {
  return {
    flowName,
    flowSeen: result.flowSeen,
    sourceMetadataSeen: result.sourceMetadataSeen,
    eventsSeen: result.eventsSeen,
    eventsWritten: result.eventsWritten,
  };
}

export function createLeadConduitActionHandlers(dependencies: LeadConduitActionDependencies) {
  return {
    async testConnection(
      previous: LeadConduitActionState,
      formData: FormData,
    ): Promise<LeadConduitActionState> {
      void previous;
      void formData;
      const companyId = await dependencies.getAdminCompanyId();
      if (!companyId) return { status: "failed", message: "Administrator access is required." };
      if (!dependencies.probeEnabled()) {
        return { status: "failed", message: "LeadConduit connection probe is disabled." };
      }
      try {
        const probe = await dependencies.probe(companyId);
        return {
          status: probe.ok ? "succeeded" : "failed",
          probe,
          ...(!probe.ok ? { message: "LeadConduit connection probe failed." } : {}),
        };
      } catch {
        return { status: "failed", message: "LeadConduit connection probe could not run." };
      }
    },

    async importShadow(
      previous: LeadConduitActionState,
      formData: FormData,
    ): Promise<LeadConduitActionState> {
      void previous;
      const companyId = await dependencies.getAdminCompanyId();
      if (!companyId) return { status: "failed", message: "Administrator access is required." };
      const flowSlug = flowSlugFrom(formData);
      if (!flowSlug) return { status: "failed", message: "LeadConduit flow is invalid." };
      const binding = dependencies.getBinding(flowSlug);
      if (!binding || binding.companyId !== companyId) {
        return { status: "failed", message: "LeadConduit flow binding is unavailable." };
      }
      if (!binding.capabilities.shadowImport) {
        return { status: "failed", message: `${binding.flowName} shadow import is disabled.` };
      }
      if (!shadowSafetyControlsAreDisabled(binding)) {
        return {
          status: "failed",
          message: "LeadConduit shadow safety controls must remain disabled.",
        };
      }
      try {
        const importResult = await dependencies.importShadow(companyId, flowSlug);
        if (importResult.outcome === "failed") {
          return {
            status: "failed",
            importResult: sanitizedShadowResult(binding.flowName, importResult),
            message: `${binding.flowName} shadow import failed.`,
          };
        }
        dependencies.revalidate();
        return {
          status: "succeeded",
          importResult: sanitizedShadowResult(binding.flowName, importResult),
        };
      } catch {
        return { status: "failed", message: `${binding.flowName} shadow import could not run.` };
      }
    },
  };
}
