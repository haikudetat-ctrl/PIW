import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export function createSupabaseEmailLinkStore(client: SupabaseClient<Database>) {
  return {
    async rotate({companyId, previewId, tokenHash}: {companyId: string; previewId: string; tokenHash: string}) {
      const {data, error} = await client
        .from("property_previews")
        .update({token_hash: tokenHash, updated_at: new Date().toISOString()})
        .eq("company_id", companyId)
        .eq("id", previewId)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .select("id");
      return !error && (data?.length ?? 0) > 0;
    },
    async unsubscribe({companyId, previewId}: {companyId: string; previewId: string}) {
      const {data, error} = await client
        .from("property_previews")
        .update({unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString()})
        .eq("company_id", companyId)
        .eq("id", previewId)
        .select("saved_email_normalized");
      if (error || !data?.length) return false;
      const email = data[0].saved_email_normalized;
      if (email) {
        const {error: suppressionError} = await client
          .from("property_preview_email_suppressions")
          .upsert({company_id: companyId, email_normalized: email}, {onConflict: "company_id,email_normalized", ignoreDuplicates: true});
        if (suppressionError) return false;
      }
      return true;
    },
  };
}
