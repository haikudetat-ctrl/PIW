import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PublicHostLookup } from "./public-host";

export function createSupabasePublicHostLookup(client: SupabaseClient<Database>): PublicHostLookup {
  return async (host) => {
    const {data, error} = await client
      .from("company_public_hosts")
      .select("company_id, verified_at, brand")
      .eq("host", host)
      .maybeSingle();
    if (error) throw new Error("Failed to resolve public host");
    return data;
  };
}
