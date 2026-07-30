"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { taskInputSchema } from "@/modules/tasks/schema";

export async function createTask(leadId: string, formData: FormData) {
  const input = taskInputSchema.parse(Object.fromEntries(formData));
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

  await supabase.from("tasks").insert({
    company_id: adminProfile.company_id,
    lead_id: leadId,
    title: input.title,
    description: input.description,
    due_at: input.dueAt,
    assigned_to: input.assignedTo ?? user.id,
    created_by: user.id,
  });

  revalidatePath(`/leads/${leadId}`);
}

export async function completeTask(leadId: string, taskId: string) {
  const supabase = await createServerClient();
  await supabase
    .from("tasks")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", taskId);

  revalidatePath(`/leads/${leadId}`);
}
