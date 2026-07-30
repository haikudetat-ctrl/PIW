"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createEventEnvelope } from "@/domain/events";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { submitLeadIntake } from "@/modules/leads/submit-lead-intake";
import { parseLeadIntakeFormData } from "./lead-intake-form-data";

export async function createLead(formData: FormData) {
  const input = parseLeadIntakeFormData(formData);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) redirect("/login");

  const service = createServiceClient();

  const result = await submitLeadIntake(input, {
    createLeadRecords: async (lead) => {
      const { data, error } = await service.rpc("submit_lead_intake", {
        p_company_id: adminProfile.company_id,
        p_name: lead.name,
        p_phone: lead.phone,
        p_email: lead.email,
        p_submitted_address: lead.submittedAddress,
        // The SQL parameter is nullable text, but Supabase's generated Args
        // type doesn't mark params without a SQL DEFAULT as nullable.
        p_notes: (lead.notes ?? null) as string,
        p_correlation_id: lead.correlationId,
        p_pipeline_version: 1,
      });
      if (error || !data?.[0]) throw new Error("Failed to create lead intake");
      return {
        leadId: data[0].lead_id,
        propertyId: data[0].property_id,
        pipelineRunId: data[0].pipeline_run_id,
      };
    },
    enqueueLeadSubmitted: async ({ leadId, propertyId, pipelineRunId, correlationId, lead }) => {
      const event = createEventEnvelope({
        name: "crm/lead.submitted",
        correlationId,
        pipelineRunId,
        leadId,
        propertyId,
        data: {
          leadId,
          propertyId,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          submittedAddress: lead.submittedAddress,
          serviceRequested: "roofing",
          notes: lead.notes,
        },
      });
      const outbox = new SupabaseOutboxRepository(service);
      await outbox.enqueue(event, adminProfile.company_id);
    },
  });

  redirect(`/leads/${result.leadId}`);
}
