"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { createEventEnvelope } from "@/domain/events";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueueAndPublishEvent } from "@/modules/events/enqueue-and-publish-event";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import {
  formatSubmittedAddress,
  parsePublicRoofEstimateFormData,
} from "./form-data";

export type PublicRoofEstimateState = { error?: string };

async function resolveEstimateCompanyId() {
  const environment = parseServerEnv(process.env);
  if (environment.ROOF_ESTIMATE_COMPANY_ID) {
    return environment.ROOF_ESTIMATE_COMPANY_ID;
  }
  const service = createServiceClient();
  const { data, error } = await service.from("companies").select("id").limit(2);
  if (error || data?.length !== 1) {
    throw new Error("Roof estimate company is not configured");
  }
  return data[0].id;
}

export async function submitPublicRoofEstimate(
  _previousState: PublicRoofEstimateState,
  formData: FormData,
): Promise<PublicRoofEstimateState> {
  let input;
  try {
    input = parsePublicRoofEstimateFormData(formData);
  } catch {
    return { error: "Check the highlighted information and accept each consent item." };
  }

  try {
    const service = createServiceClient();
    const companyId = await resolveEstimateCompanyId();
    const correlationId = crypto.randomUUID();
    const requestHeaders = await headers();
    const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
    const { data, error } = await service.rpc("submit_roof_estimate_lead", {
      p_company_id: companyId,
      p_name: input.name,
      p_phone: input.phone,
      p_email: input.email,
      p_submitted_address: formatSubmittedAddress(input),
      p_disclosure_version: "roof-estimate-v1",
      p_ip_address: forwardedFor ?? "",
      p_user_agent: requestHeaders.get("user-agent") ?? "",
      p_correlation_id: correlationId,
      p_pipeline_version: 2,
      p_google_place_id: input.googlePlaceId ?? "",
    });
    if (
      error ||
      !data?.[0]?.pipeline_run_id ||
      !data[0].lead_id ||
      !data[0].property_id ||
      !data[0].public_token
    ) {
      throw new Error("Failed to save estimate request");
    }
    const created = data[0];
    const event = createEventEnvelope({
      name: "crm/lead.submitted",
      correlationId,
      pipelineRunId: created.pipeline_run_id,
      leadId: created.lead_id,
      propertyId: created.property_id,
      data: {
        leadId: created.lead_id,
        propertyId: created.property_id,
        name: input.name,
        phone: input.phone,
        email: input.email,
        submittedAddress: formatSubmittedAddress(input),
        googlePlaceId: input.googlePlaceId,
        serviceRequested: "roofing",
      },
    });
    await enqueueAndPublishEvent({
      repository: new SupabaseOutboxRepository(service),
      event,
      companyId,
      send: (outbound) => inngest.send(outbound),
    });
    redirect(`/roof-estimate/${created.public_token}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Roof estimate submission failed", {
      error:
        error instanceof ZodError
          ? error.issues.map((issue) => ({
              path: issue.path.join("."),
              code: issue.code,
              message: issue.message,
            }))
          : error instanceof Error
            ? error.message
            : "Unknown submission error",
    });
    return { error: "We could not start the estimate right now. Please try again." };
  }
}
