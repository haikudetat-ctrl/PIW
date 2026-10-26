"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isLeadFlag } from "@/domain/paid-search";
import { createServerClient } from "@/lib/supabase/server";

type RpcClient = {rpc(name: string, args: Record<string, unknown>): PromiseLike<{error: unknown}>};

/**
 * Marks a paid lead as junk. The database checks the manager role and the
 * company; a flagged lead is never uploaded to Google Ads, and conversions
 * sent within the last 14 days are retracted on the next scheduler run.
 */
export async function flagPaidLead(formData: FormData) {
  const leadId = z.uuid().safeParse(formData.get("lead_id"));
  const flag = String(formData.get("flag") ?? "");
  if (!leadId.success) return;
  const supabase = (await createServerClient()) as unknown as RpcClient;
  if (flag === "clear") {
    await supabase.rpc("clear_lead_quality_flag", {p_lead_id: leadId.data});
  } else if (isLeadFlag(flag)) {
    await supabase.rpc("flag_lead_quality", {p_lead_id: leadId.data, p_flag: flag, p_note: null});
  }
  revalidatePath("/reports/paid-search");
}
