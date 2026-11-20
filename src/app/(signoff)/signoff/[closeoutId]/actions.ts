"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HOMEOWNER_TERMS_VERSION, signoffInputSchema } from "@/domain/closeouts";
import { canUseCrm, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";

export type SignoffState = { error: string | null };

export async function recordSignoff(_previous: SignoffState, formData: FormData): Promise<SignoffState> {
  const closeoutId = z.uuid().parse(formData.get("closeoutId"));
  const version = z.coerce.number().int().positive().parse(formData.get("version"));
  const jobJnid = z.string().min(1).max(64).parse(formData.get("jobJnid"));

  const parsed = signoffInputSchema.safeParse({
    homeownerName: formData.get("homeownerName"),
    outcome: formData.get("outcome"),
    photoRelease: formData.get("photoRelease") ?? undefined,
    reviewRequestOk: formData.get("reviewRequestOk") ?? undefined,
    signaturePath: formData.get("signaturePath") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your answers and sign again." };

  const supabase = await createServerClient();
  const { data: accessRows } = await supabase.rpc("get_my_access");
  const access = parseMyAccess(accessRows);
  if (!access || !canUseCrm(access)) return { error: "This device is no longer signed in. Hand it back to your project manager." };

  const userAgent = (await headers()).get("user-agent") ?? "";
  const { error } = await supabase.rpc("record_job_closeout_signoff", {
    p_closeout_id: closeoutId,
    p_expected_version: version,
    p_homeowner_name: parsed.data.homeownerName,
    p_outcome: parsed.data.outcome,
    p_photo_release: parsed.data.photoRelease,
    p_review_request_ok: parsed.data.reviewRequestOk,
    p_signature_path: parsed.data.signaturePath,
    p_terms_version: HOMEOWNER_TERMS_VERSION,
    p_user_agent: userAgent.slice(0, 400),
  });
  if (error) {
    if (error.code === "40001") return { error: "The closeout changed after this page opened. Hand the phone back to reload it." };
    if (error.code === "22023" && error.message) return { error: error.message };
    return { error: "Your signature didn't save. Try again." };
  }

  revalidatePath(`/closeouts/${jobJnid}`);
  redirect(`/signoff/${closeoutId}`);
}
