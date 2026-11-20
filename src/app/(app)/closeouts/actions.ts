"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { closeoutGaps, parseCloseoutForm, parsePrefill } from "@/domain/closeouts";
import { inngest } from "@/inngest/client";
import { canUseCrm, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";

export type CloseoutFormState = {
  error: string | null;
  gaps: string[];
  savedAt: string | null;
  version: number;
};

async function managerSession() {
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_my_access");
  const access = parseMyAccess(data);
  if (!access || !canUseCrm(access)) throw new Error("Manager access required");
  return { supabase, access };
}

// Work starts at once; the ten-minute sweep is the safety net if this
// event is lost.
async function requestCloseoutWork(companyId: string, closeoutId: string) {
  try {
    await inngest.send({ name: "production/closeout.work_requested", data: { companyId, closeoutId } });
  } catch {
    // Swept within ten minutes.
  }
}

function rpcMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "Something went wrong. Try again.";
  if (error.code === "40001") return "This closeout changed on another screen. Reload to see the latest.";
  if (error.code === "22023" && error.message) return error.message;
  if (error.code === "42501") return "You don't have access to this closeout.";
  return "Couldn't save the closeout. Try again.";
}

const jnidSchema = z.string().trim().min(1).max(64);

export async function startCloseout(formData: FormData) {
  const jobJnid = jnidSchema.parse(formData.get("jobJnid"));
  const { supabase, access } = await managerSession();
  const { data: closeoutId, error } = await supabase.rpc("start_job_closeout", { p_job_jnid: jobJnid });
  if (error || !closeoutId) throw new Error(rpcMessage(error));
  await requestCloseoutWork(access.companyId, closeoutId);
  revalidatePath("/closeouts");
  redirect(`/closeouts/${encodeURIComponent(jobJnid)}`);
}

export async function saveCloseout(previous: CloseoutFormState, formData: FormData): Promise<CloseoutFormState> {
  const closeoutId = z.uuid().parse(formData.get("closeoutId"));
  const version = z.coerce.number().int().positive().parse(formData.get("version"));
  const intent = z.enum(["save", "signoff", "submit"]).catch("save").parse(formData.get("intent"));
  const { supabase, access } = await managerSession();

  // The job type decides which checklist items exist; read it from the
  // closeout rather than trusting the form.
  const { data: closeout } = await supabase
    .from("job_closeouts")
    .select("id, job_jnid, prefill, homeowner_signed_at")
    .eq("id", closeoutId)
    .maybeSingle();
  if (!closeout) return { ...previous, error: "You don't have access to this closeout.", gaps: [] };
  const jobType = parsePrefill(closeout.prefill).job.job_type ?? null;

  let fields;
  try {
    fields = parseCloseoutForm(formData, jobType);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : null;
    return { ...previous, error: message ? `Check the form: ${message}` : "Check the form and try again.", gaps: [] };
  }

  const { data: savedVersion, error } = await supabase.rpc("save_job_closeout", {
    p_closeout_id: closeoutId,
    p_expected_version: version,
    p_fields: fields,
  });
  if (error || typeof savedVersion !== "number") return { ...previous, error: rpcMessage(error), gaps: [] };
  revalidatePath(`/closeouts/${closeout.job_jnid}`);

  if (intent === "signoff") redirect(`/signoff/${closeoutId}`);

  if (intent === "submit") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const gaps = closeoutGaps(
      {
        installStartedOn: fields.install_started_on || null,
        installCompletedOn: fields.install_completed_on || null,
        checklist: fields.checklist,
        homeownerSignedAt: closeout.homeowner_signed_at,
        homeownerUnavailableReason: fields.homeowner_unavailable_reason || null,
        selectedPhotoCount: fields.selected_photo_jnids.length,
      },
      jobType,
      today,
    );
    if (gaps.length > 0) {
      return { error: "Saved. A few things are needed before you can submit.", gaps, savedAt: new Date().toISOString(), version: savedVersion };
    }
    const { error: submitError } = await supabase.rpc("submit_job_closeout", {
      p_closeout_id: closeoutId,
      p_expected_version: savedVersion,
    });
    if (submitError) return { error: rpcMessage(submitError), gaps: [], savedAt: new Date().toISOString(), version: savedVersion };
    await requestCloseoutWork(access.companyId, closeoutId);
    revalidatePath("/closeouts");
    redirect(`/closeouts/${encodeURIComponent(closeout.job_jnid)}`);
  }

  return { error: null, gaps: [], savedAt: new Date().toISOString(), version: savedVersion };
}

export async function clearSignoff(formData: FormData) {
  const closeoutId = z.uuid().parse(formData.get("closeoutId"));
  const version = z.coerce.number().int().positive().parse(formData.get("version"));
  const jobJnid = jnidSchema.parse(formData.get("jobJnid"));
  const { supabase } = await managerSession();
  const { error } = await supabase.rpc("clear_job_closeout_signoff", { p_closeout_id: closeoutId, p_expected_version: version });
  if (error) throw new Error(rpcMessage(error));
  revalidatePath(`/closeouts/${jobJnid}`);
  redirect(`/closeouts/${encodeURIComponent(jobJnid)}`);
}

export async function retryCloseoutWrite(formData: FormData) {
  const writeId = z.uuid().parse(formData.get("writeId"));
  const closeoutId = z.uuid().parse(formData.get("closeoutId"));
  const jobJnid = jnidSchema.parse(formData.get("jobJnid"));
  const { supabase, access } = await managerSession();
  const { error } = await supabase.rpc("retry_job_closeout_write", { p_write_id: writeId });
  if (error) throw new Error(rpcMessage(error));
  await requestCloseoutWork(access.companyId, closeoutId);
  revalidatePath(`/closeouts/${jobJnid}`);
}
