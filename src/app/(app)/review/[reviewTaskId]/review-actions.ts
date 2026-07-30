"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Database } from "@/lib/database.types";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import {
  applyReviewActionCore,
  type RetryContext,
  type ReviewAction,
} from "./review-action-service";

type ReviewTaskRow =
  Database["public"]["Tables"]["review_tasks"]["Row"];

function notesFrom(formData: FormData): string | null {
  const value = formData.get("notes");
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function selectedCandidateFrom(formData: FormData): number | null {
  const value = formData.get("selectedCandidateIndex");
  if (typeof value !== "string" || value === "") return null;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Invalid selected candidate");
  }
  return index;
}

async function applyReviewAction(
  reviewTaskId: string,
  action: ReviewAction,
  selectedCandidateIndex: number | null,
  notes: string | null,
) {
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
  await applyReviewActionCore(
    {
      companyId: adminProfile.company_id,
      reviewTaskId,
      adminId: user.id,
      action,
      selectedCandidateIndex,
      notes,
    },
    {
      resolveTask: async (input) => {
        const { data, error } = await service.rpc("resolve_review_task", {
          p_company_id: input.companyId,
          p_review_task_id: input.reviewTaskId,
          p_action: input.action,
          p_admin_id: input.adminId,
          p_selected_candidate_index:
            input.selectedCandidateIndex as number,
          p_notes: input.notes as string,
        });
        const resolution = data?.[0];
        if (error || !resolution) {
          throw new Error(`Failed to ${input.action} review task`);
        }
        if (resolution.new_status === "open") {
          throw new Error("Review task action did not close the task");
        }
        return {
          newStatus: resolution.new_status,
          pipelineRunId: resolution.pipeline_run_id,
          propertyId: resolution.property_id,
          nextAttempt: resolution.next_attempt ?? null,
        };
      },
      writeAudit: async (entry) => {
        await writeAuditEntry(entry, service);
      },
      loadRetryContext: async (input): Promise<RetryContext> => {
        const { data: task, error: taskError } = await service
          .from("review_tasks")
          .select(
            "company_id, triggering_event_name, lead_id, property_id, pipeline_run_id",
          )
          .eq("id", input.reviewTaskId)
          .eq("company_id", input.companyId)
          .single();
        if (taskError || !task) {
          throw new Error("Failed to load retry review task");
        }

        const [{ data: pipeline }, { data: lead }, { data: address }] =
          await Promise.all([
            service
              .from("pipeline_runs")
              .select("company_id, correlation_id, lead_id, property_id")
              .eq("id", task.pipeline_run_id)
              .eq("company_id", input.companyId)
              .single(),
            service
              .from("leads")
              .select("company_id, submitted_address, property_id")
              .eq("id", task.lead_id)
              .eq("company_id", input.companyId)
              .single(),
            service
              .from("property_addresses")
              .select("canonical_address, latitude, longitude")
              .eq("property_id", task.property_id)
              .eq("company_id", input.companyId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

        if (
          !pipeline ||
          !lead ||
          pipeline.company_id !== input.companyId ||
          lead.company_id !== input.companyId ||
          pipeline.lead_id !== task.lead_id ||
          pipeline.property_id !== task.property_id ||
          lead.property_id !== task.property_id
        ) {
          throw new Error("Retry context failed company scope validation");
        }

        const triggeringEventName =
          task.triggering_event_name as ReviewTaskRow["triggering_event_name"];
        if (
          triggeringEventName !== "property/address.validation_requested" &&
          triggeringEventName !== "property/discovery_requested"
        ) {
          throw new Error("Unsupported retry event");
        }

        return {
          triggeringEventName,
          pipelineRunId: task.pipeline_run_id,
          correlationId: pipeline.correlation_id,
          leadId: task.lead_id,
          propertyId: task.property_id,
          submittedAddress: lead.submitted_address,
          canonicalAddress: address?.canonical_address ?? null,
          latitude: address?.latitude ?? null,
          longitude: address?.longitude ?? null,
        };
      },
      enqueueRetry: async (companyId, event) => {
        await new SupabaseOutboxRepository(service).enqueue(event, companyId);
      },
    },
  );

  revalidatePath("/review");
  revalidatePath(`/review/${reviewTaskId}`);
  revalidatePath("/");
}

export async function resolveReviewTask(
  reviewTaskId: string,
  formData: FormData,
) {
  await applyReviewAction(
    reviewTaskId,
    "resolve",
    selectedCandidateFrom(formData),
    notesFrom(formData),
  );
}

export async function rejectReviewTask(
  reviewTaskId: string,
  formData: FormData,
) {
  await applyReviewAction(
    reviewTaskId,
    "reject",
    null,
    notesFrom(formData),
  );
}

export async function retryReviewTask(
  reviewTaskId: string,
  formData: FormData,
) {
  await applyReviewAction(
    reviewTaskId,
    "retry",
    null,
    notesFrom(formData),
  );
}

export async function markReviewTaskUnsupported(
  reviewTaskId: string,
  formData: FormData,
) {
  await applyReviewAction(
    reviewTaskId,
    "unsupported",
    null,
    notesFrom(formData),
  );
}
