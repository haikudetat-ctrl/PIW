import type {
  JobNimbusCanaryResult,
} from "@/modules/access-route/jobnimbus-canary";
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
  isCanaryEnabled: () => boolean;
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
      if (!dependencies.isCanaryEnabled()) {
        return { status: "failed", message: "JobNimbus staging canary is disabled." };
      }
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
      if (!dependencies.isCanaryEnabled()) {
        return { status: "failed", message: "JobNimbus staging canary is disabled." };
      }
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
