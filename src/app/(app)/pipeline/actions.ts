"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";
import { changeLeadStage, type LeadStage } from "@/modules/leads/change-lead-stage";

export async function moveLeadStage(leadId: string, toStage: LeadStage) {
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

  const service = createServiceClient();

  await changeLeadStage(
    { leadId, toStage },
    {
      applyStageChange: async ({ leadId: id, toStage: stage }) => {
        const { data, error } = await service.rpc("change_lead_stage", {
          p_company_id: adminProfile.company_id,
          p_lead_id: id,
          p_to_stage: stage,
          p_changed_by: user.id,
          // The SQL parameter is nullable text; the generated Args type
          // doesn't mark params without a SQL DEFAULT as nullable.
          p_note: null as unknown as string,
        });
        if (error || !data?.[0]) throw new Error("Failed to change lead stage");
        return { fromStage: data[0].from_stage };
      },
      recordAuditEntry: async ({ leadId: id, fromStage, toStage: stage }) => {
        await writeAuditEntry(
          {
            companyId: adminProfile.company_id,
            actorId: user.id,
            action: "lead.stage_changed",
            entityType: "lead",
            entityId: id,
            metadata: { fromStage, toStage: stage },
          },
          service,
        );
      },
    },
  );

  revalidatePath("/pipeline");
  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
}
