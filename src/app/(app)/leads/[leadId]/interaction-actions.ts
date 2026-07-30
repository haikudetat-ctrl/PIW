"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { interactionInputSchema } from "@/modules/interactions/schema";

export async function logInteraction(leadId: string, formData: FormData) {
  const input = interactionInputSchema.parse(Object.fromEntries(formData));
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) return;

  await supabase.from("interactions").insert({
    company_id: adminProfile.company_id,
    lead_id: leadId,
    type: input.type,
    summary: input.summary,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    created_by: user.id,
  });

  revalidatePath(`/leads/${leadId}`);
}
