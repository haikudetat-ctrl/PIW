"use server";

import { revalidatePath } from "next/cache";
import { parseServerEnv } from "@/lib/env/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  importJobNimbusCanary,
} from "@/modules/access-route/jobnimbus-canary";
import { getLeadConduitFlowBinding } from "@/modules/access-route/leadconduit-config";
import {
  importLeadConduitShadow as runLeadConduitShadowImport,
  probeLeadConduitConnection,
} from "@/modules/access-route/leadconduit-shadow-import";
import { SupabaseAccessRouteRepository } from "@/modules/access-route/repository";
import { JobNimbusReadClient } from "@/modules/access-route/vendors";
import {
  createJobNimbusActionHandlers,
  createLeadConduitActionHandlers,
  type JobNimbusActionState,
  type LeadConduitActionState,
} from "./action-handlers";

async function getAdminCompanyId(): Promise<string | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.company_id ?? null;
}

function jobNimbusClient() {
  const environment = parseServerEnv(process.env);
  if (!environment.JOBNIMBUS_API_KEY) throw new Error("JobNimbus API key is not configured");
  return new JobNimbusReadClient({
    apiKey: environment.JOBNIMBUS_API_KEY,
    baseUrl: environment.JOBNIMBUS_BASE_URL,
    contactsPath: environment.JOBNIMBUS_CONTACTS_PATH,
    jobsPath: environment.JOBNIMBUS_JOBS_PATH,
    pageLimit: environment.JOBNIMBUS_PAGE_LIMIT,
    maxPages: environment.JOBNIMBUS_MAX_PAGES,
  });
}

const handlers = createJobNimbusActionHandlers({
  getAdminCompanyId,
  probe: () => jobNimbusClient().probe(),
  importSample: async (companyId) => {
    const environment = parseServerEnv(process.env);
    const repository = new SupabaseAccessRouteRepository(createServiceClient());
    return importJobNimbusCanary({ companyId, environment, repository });
  },
  revalidate: () => {
    revalidatePath("/access-route");
    revalidatePath("/access-route/jobnimbus");
  },
});

const leadConduitHandlers = createLeadConduitActionHandlers({
  getAdminCompanyId,
  probeEnabled: () => parseServerEnv(process.env).INTEGRATIONS_LEADCONDUIT_PROBE_ENABLED,
  getBinding: (flowSlug) => getLeadConduitFlowBinding(
    flowSlug,
    parseServerEnv(process.env),
  ),
  probe: async (companyId) => {
    const environment = parseServerEnv(process.env);
    const repository = new SupabaseAccessRouteRepository(createServiceClient());
    return probeLeadConduitConnection({ companyId, environment, repository });
  },
  importShadow: async (companyId, flowSlug) => {
    const environment = parseServerEnv(process.env);
    const repository = new SupabaseAccessRouteRepository(createServiceClient());
    return runLeadConduitShadowImport({
      companyId,
      flowSlug,
      environment,
      repository,
    });
  },
  revalidate: () => {
    revalidatePath("/access-route");
    revalidatePath("/access-route/leadconduit");
  },
});

export async function testJobNimbusConnection(
  previous: JobNimbusActionState,
  formData: FormData,
): Promise<JobNimbusActionState> {
  return handlers.testConnection(previous, formData);
}

export async function importJobNimbusSample(
  previous: JobNimbusActionState,
  formData: FormData,
): Promise<JobNimbusActionState> {
  return handlers.importSample(previous, formData);
}

export async function testLeadConduitConnection(
  previous: LeadConduitActionState,
  formData: FormData,
): Promise<LeadConduitActionState> {
  return leadConduitHandlers.testConnection(previous, formData);
}

export async function importLeadConduitShadow(
  previous: LeadConduitActionState,
  formData: FormData,
): Promise<LeadConduitActionState> {
  return leadConduitHandlers.importShadow(previous, formData);
}
