"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  applyReviewActionCore,
  type ReviewAction,
} from "./review-action-service";

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
