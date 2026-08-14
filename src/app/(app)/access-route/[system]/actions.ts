"use server";

import { revalidatePath } from "next/cache";
import { parseServerEnv } from "@/lib/env/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  importJobNimbusCanary,
} from "@/modules/access-route/jobnimbus-canary";
import { SupabaseAccessRouteRepository } from "@/modules/access-route/repository";
import { JobNimbusReadClient } from "@/modules/access-route/vendors";
import {
  createJobNimbusActionHandlers,
  type JobNimbusActionState,
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
  isCanaryEnabled: () => parseServerEnv(process.env).INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED,
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
