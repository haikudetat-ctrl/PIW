import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import {
  checklistFor,
  formatAddress,
  homeownerStatement,
  packageFilename,
  parsePrefill,
  photoReleaseText,
  reviewRequestText,
  workDescription,
  type HomeownerOutcome,
} from "@/domain/closeouts";
import type { Database } from "@/lib/database.types";
import { CloseoutPackageDocument, type CloseoutPackageProps } from "./package-document";
import { CLOSEOUT_BUCKET } from "./photo-prep";

// Everything the package needs, read with the service role. Callers check
// the reader's access first (the preview route reads the closeout through
// the user's session before calling this).

export type RenderedPackage = {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  jobJnid: string;
  companyId: string;
  version: number;
};

export async function loadCloseoutPackageProps(
  database: SupabaseClient<Database>,
  closeoutId: string,
  options: { now?: Date } = {},
): Promise<{ props: CloseoutPackageProps; filename: string; jobJnid: string; companyId: string; version: number }> {
  const { data: closeout, error } = await database.from("job_closeouts").select("*").eq("id", closeoutId).maybeSingle();
  if (error) throw new Error("Closeout lookup failed", { cause: error });
  if (!closeout) throw new Error("Closeout not found");

  const prefill = parsePrefill(closeout.prefill);
  const [companyResult, submitterResult, photoResult] = await Promise.all([
    database.from("companies").select("name").eq("id", closeout.company_id).maybeSingle(),
    closeout.submitted_by
      ? database.from("admin_profiles").select("display_name").eq("id", closeout.submitted_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    closeout.selected_photo_jnids.length > 0
      ? database
          .from("job_closeout_photos")
          .select("file_jnid, print_path, taken_at")
          .eq("closeout_id", closeout.id)
          .eq("outcome", "ready")
          .in("file_jnid", closeout.selected_photo_jnids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (photoResult.error) throw new Error("Closeout photo lookup failed", { cause: photoResult.error });

  const byJnid = new Map((photoResult.data ?? []).map((photo) => [photo.file_jnid, photo]));
  const photos: CloseoutPackageProps["photos"] = [];
  for (const jnid of closeout.selected_photo_jnids) {
    const photo = byJnid.get(jnid);
    if (!photo?.print_path) continue;
    const download = await database.storage.from(CLOSEOUT_BUCKET).download(photo.print_path);
    if (download.error || !download.data) throw new Error("Closeout photo download failed", { cause: download.error });
    photos.push({ data: Buffer.from(await download.data.arrayBuffer()), takenAt: photo.taken_at });
  }

  const companyName = companyResult.data?.name ?? "Your roofing contractor";
  const address = formatAddress(prefill.job);
  const checklistAnswers = closeout.checklist as Record<string, unknown>;
  const signed =
    closeout.homeowner_signed_at
    && closeout.homeowner_signature_path
    && closeout.homeowner_name
    && closeout.homeowner_outcome
    && (closeout.photo_release === "granted" || closeout.photo_release === "declined")
    && closeout.install_completed_on;

  const props: CloseoutPackageProps = {
    companyName,
    closeoutRef: closeout.id.slice(0, 8).toUpperCase(),
    jobNumber: prefill.job.number ?? null,
    customerName: prefill.job.customer_name ?? null,
    address,
    jobType: prefill.job.job_type ?? null,
    shingleLine: prefill.job.shingle_line ?? null,
    salesRep: prefill.job.sales_rep_name ?? null,
    deliveredOn: prefill.delivered_at,
    deliveryDocuments: prefill.delivery_documents
      .map((document) => document.filename)
      .filter((name): name is string => Boolean(name)),
    installStartedOn: closeout.install_started_on ?? closeout.install_completed_on ?? "",
    installCompletedOn: closeout.install_completed_on ?? closeout.install_started_on ?? "",
    crew: closeout.crew,
    squaresInstalled: closeout.squares_installed === null ? null : Number(closeout.squares_installed),
    layersRemoved: closeout.layers_removed,
    deckingSheetsReplaced: closeout.decking_sheets_replaced,
    checklist: checklistFor(prefill.job.job_type ?? null).map((item) => {
      const answer = checklistAnswers[item.key];
      return { label: item.label, answer: answer === "done" || answer === "na" ? answer : null };
    }),
    punchItems: closeout.punch_items,
    productionNotes: closeout.production_notes,
    homeowner: signed
      ? {
          name: closeout.homeowner_name!,
          signedAt: closeout.homeowner_signed_at!,
          statement: homeownerStatement({
            companyName,
            workDescription: workDescription(prefill.job.job_type ?? null),
            address,
            completedOn: closeout.install_completed_on!,
            outcome: closeout.homeowner_outcome as HomeownerOutcome,
            openItems: closeout.punch_items,
          }),
          photoRelease: closeout.photo_release as "granted" | "declined",
          photoReleaseText: photoReleaseText(companyName),
          reviewRequestOk: Boolean(closeout.review_request_ok),
          reviewRequestText: reviewRequestText(companyName),
          signaturePath: closeout.homeowner_signature_path!,
          termsVersion: closeout.homeowner_terms_version ?? "",
        }
      : null,
    homeownerUnavailableReason: closeout.homeowner_unavailable_reason,
    submittedBy: submitterResult.data?.display_name ?? null,
    submittedAt: closeout.submitted_at ?? (options.now ?? new Date()).toISOString(),
    photos,
  };

  return {
    props,
    filename: packageFilename(prefill.job.number ?? null, closeout.id),
    jobJnid: closeout.job_jnid,
    companyId: closeout.company_id,
    version: closeout.version,
  };
}

export async function renderCloseoutPackage(
  database: SupabaseClient<Database>,
  closeoutId: string,
): Promise<RenderedPackage> {
  const loaded = await loadCloseoutPackageProps(database, closeoutId);
  const pdf = await renderToBuffer(
    createElement(CloseoutPackageDocument, loaded.props) as Parameters<typeof renderToBuffer>[0],
  );
  return {
    bytes: new Uint8Array(pdf),
    filename: loaded.filename,
    jobJnid: loaded.jobJnid,
    companyId: loaded.companyId,
    version: loaded.version,
  };
}
