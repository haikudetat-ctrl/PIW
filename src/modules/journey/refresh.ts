import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type JourneyRefreshResult = {
  attached: number;
  unmatched: number;
  eventsAdded: number;
  openConflicts: number;
};

// Companies with journey data: every company with an enabled JobNimbus
// integration, plus the company bound to the LeadConduit receiver.
export async function listJourneyCompanies(
  database: SupabaseClient<Database>,
  leadConduitCompanyId: string | undefined,
): Promise<string[]> {
  const { data, error } = await database
    .from("company_integrations")
    .select("company_id")
    .eq("enabled", true);
  if (error || !data) throw new Error("Journey company listing failed", { cause: error });
  const companies = new Set(data.map((row) => row.company_id));
  if (leadConduitCompanyId) companies.add(leadConduitCompanyId);
  return [...companies].sort();
}

export function parseJourneyRefreshResult(value: unknown): JourneyRefreshResult {
  const record = (value ?? {}) as Record<string, unknown>;
  const count = (key: string) => {
    const number = Number(record[key]);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  };
  return {
    attached: count("attached"),
    unmatched: count("unmatched"),
    eventsAdded: count("events_added"),
    openConflicts: count("open_conflicts"),
  };
}

export async function refreshCustomerJourney(
  database: SupabaseClient<Database>,
  companyId: string,
): Promise<JourneyRefreshResult> {
  const { data, error } = await database.rpc("refresh_customer_journey", { p_company_id: companyId });
  if (error) throw new Error("Customer journey refresh failed", { cause: error });
  return parseJourneyRefreshResult(data);
}
