import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { plainButtonClasses, primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { checklistFor, closeoutGaps, formatAddress, isPreSaleStatus, parsePrefill } from "@/domain/closeouts";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CLOSEOUT_BUCKET } from "@/modules/closeouts/photo-prep";
import { installRange } from "@/modules/closeouts/package-document";
import { JOBNIMBUS_JOB_URL } from "@/modules/leads/jobnimbus-pipeline";
import { retryCloseoutWrite, startCloseout } from "../actions";
import { CloseoutForm } from "./closeout-form";

function shortDate(iso: string | null): string {
  if (!iso) return "Not recorded";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="shrink-0 text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] font-medium break-words text-ink">{value}</dd>
    </div>
  );
}

const WRITE_LABEL: Record<string, string> = {
  attach_package: "Attach the package PDF",
  set_completed_status: "Move the job to completed",
};

const WRITE_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  in_progress: "info",
  succeeded: "success",
  skipped: "success",
  failed: "danger",
};

const WRITE_STATUS: Record<string, string> = {
  queued: "Waiting",
  in_progress: "Working",
  succeeded: "Done",
  skipped: "Not needed",
  failed: "Failed",
};

export default async function CloseoutPage({ params }: { params: Promise<{ jnid: string }> }) {
  const { jnid } = await params;
  const jobJnid = decodeURIComponent(jnid);
  const supabase = await createServerClient();

  const [{ data: job }, { data: closeout }, { data: settings }] = await Promise.all([
    supabase
      .from("jn_jobs")
      .select("jnid, number, status_name, job_type, city, address_line1, state_text, zip, sales_rep_name, shingle_line, primary_contact_jnid")
      .eq("jnid", jobJnid)
      .maybeSingle(),
    supabase.from("job_closeouts").select("*").eq("job_jnid", jobJnid).maybeSingle(),
    supabase.from("job_closeout_settings").select("jobnimbus_writeback_enabled, completed_status_name").maybeSingle(),
  ]);
  if (!job) notFound();

  const { data: contact } = job.primary_contact_jnid
    ? await supabase.from("jn_contacts").select("display_name").eq("jnid", job.primary_contact_jnid).maybeSingle()
    : { data: null };
  const customerName = contact?.display_name?.trim() || (job.number ? `Job #${job.number}` : "JobNimbus job");
  const jobnimbusUrl = `${JOBNIMBUS_JOB_URL}${encodeURIComponent(job.jnid)}`;

  const header = (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px]">
        <Link href="/closeouts" className="text-tint hover:underline">
          Closeouts
        </Link>
        <Icon name="chevronRight" size={14} className="text-ink-subtle" />
        <span className="text-ink-muted">{customerName}</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-bold tracking-tight text-ink">{customerName}</h1>
            {closeout?.status === "submitted" ? <Badge tone="success">Submitted</Badge> : closeout ? <Badge tone="info">In progress</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">
            {[[job.address_line1, job.city].filter(Boolean).join(", "), job.job_type, job.shingle_line].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/jobs/${encodeURIComponent(job.jnid)}`} className={secondaryButtonClasses}>
            Job details
          </Link>
          <a href={jobnimbusUrl} target="_blank" rel="noreferrer" className={secondaryButtonClasses}>
            Open in JobNimbus
          </a>
        </div>
      </div>
    </>
  );

  if (!closeout) {
    return (
      <main className="flex max-w-3xl flex-col gap-5">
        {header}
        <Card title="Start the closeout">
          <p className="text-[13px] text-ink-muted">
            PIW fills in what JobNimbus already knows: the delivery date from the supplier receipt, the install days from when the
            crew&apos;s photos were taken, the Roofr measurement if there is one, and the job&apos;s own fields. It also copies the
            install photos so you can pick the best ones.
          </p>
          <form action={startCloseout} className="mt-4">
            <input type="hidden" name="jobJnid" value={job.jnid} />
            <button type="submit" className={primaryButtonClasses}>
              Start closeout
            </button>
          </form>
        </Card>
      </main>
    );
  }

  const prefill = parsePrefill(closeout.prefill);
  const jobType = prefill.job.job_type ?? job.job_type;
  const checklist = checklistFor(jobType).map(({ key, label }) => ({ key, label }));

  const [{ data: photoRows }, { data: writes }] = await Promise.all([
    supabase
      .from("job_closeout_photos")
      .select("file_jnid, thumb_path, taken_at, outcome")
      .eq("closeout_id", closeout.id)
      .order("taken_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("job_closeout_jobnimbus_writes")
      .select("id, kind, status, attempts, outcome_detail, completed_at, updated_at")
      .eq("closeout_id", closeout.id)
      .order("kind"),
  ]);

  // Row level security has already decided this manager may see the
  // closeout; the bucket is private, so thumbnails go out as signed URLs.
  const thumbPaths = (photoRows ?? []).map((photo) => photo.thumb_path).filter((path): path is string => Boolean(path));
  const signedUrls = new Map<string, string>();
  if (thumbPaths.length > 0) {
    const { data: signed } = await createServiceClient().storage.from(CLOSEOUT_BUCKET).createSignedUrls(thumbPaths, 60 * 60);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedUrls.set(entry.path, entry.signedUrl);
    }
  }
  const photos = (photoRows ?? []).map((photo) => ({
    fileJnid: photo.file_jnid,
    thumbUrl: photo.thumb_path ? (signedUrls.get(photo.thumb_path) ?? null) : null,
    takenAt: photo.taken_at,
    outcome: photo.outcome,
  }));

  const installGuess = prefill.install_photo_days;
  const suggestedDays =
    installGuess?.first && installGuess.last ? installRange(installGuess.first, installGuess.last) : null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const gaps = closeoutGaps(
    {
      installStartedOn: closeout.install_started_on,
      installCompletedOn: closeout.install_completed_on,
      checklist: closeout.checklist as Record<string, unknown>,
      homeownerSignedAt: closeout.homeowner_signed_at,
      homeownerUnavailableReason: closeout.homeowner_unavailable_reason,
      selectedPhotoCount: closeout.selected_photo_jnids.length,
    },
    jobType,
    today,
  );
  const { data: stageRows } = job.status_name
    ? await supabase.from("jobnimbus_status_stages").select("company_id, stage").eq("status_name", job.status_name)
    : { data: [] };
  const stage = ((stageRows ?? []).find((row) => row.company_id !== null) ?? (stageRows ?? [])[0])?.stage ?? null;
  const statusIsEarly = isPreSaleStatus(job.status_name, stage);

  const aside = (
    <aside aria-label="From JobNimbus" className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-6">
      <Card title="From JobNimbus">
        <dl>
          <Fact label="Address" value={formatAddress(prefill.job) || "Not recorded"} />
          <Fact label="Status" value={job.status_name ?? "None"} />
          <Fact label="Sales rep" value={job.sales_rep_name ?? "Unassigned"} />
          <Fact label="Materials delivered" value={shortDate(prefill.delivered_at)} />
          <Fact
            label="Photo days"
            value={suggestedDays ? `${suggestedDays} (${installGuess?.photos ?? 0} photos)` : "No photo days found"}
          />
          <Fact
            label="Roofr"
            value={prefill.roofr?.squares ? `${Number(prefill.roofr.squares).toFixed(1)} sq · ${prefill.roofr.pitch_12 ?? "?"}/12` : "No report"}
          />
        </dl>
        {statusIsEarly ? (
          <p className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning">
            JobNimbus still shows this job as {job.status_name}. Submitting moves it to{" "}
            {settings?.completed_status_name ?? "Job Completed"}.
          </p>
        ) : null}
      </Card>
      <Card title="Supplier paperwork" right={`${prefill.delivery_documents.length}`}>
        {prefill.delivery_documents.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-[13px] text-ink">
            {prefill.delivery_documents.map((document) => (
              <li key={document.jnid} className="truncate">
                {document.filename ?? "Untitled file"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-subtle">No delivery receipt or invoice on the job.</p>
        )}
      </Card>
    </aside>
  );

  if (closeout.status === "submitted") {
    return (
      <main className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {header}
          <Card title="Closeout package">
            <p className="text-[13px] text-ink-muted">
              Submitted {shortDate(closeout.submitted_at)}.{" "}
              {closeout.homeowner_signed_at
                ? `Signed by ${closeout.homeowner_name}.`
                : `Not signed: ${closeout.homeowner_unavailable_reason ?? "no reason given"}.`}{" "}
              Photos {closeout.photo_release === "granted" ? "may" : "may not"} be used publicly.
            </p>
            <a href={`/api/closeouts/${closeout.id}/pdf`} target="_blank" rel="noreferrer" className={`${plainButtonClasses} mt-3`}>
              Open the package PDF
            </a>
          </Card>
          <Card title="Filing to JobNimbus" flush>
            {settings?.jobnimbus_writeback_enabled ? null : (
              <p className="mx-5 mb-2 rounded-lg bg-surface-muted px-3 py-2 text-[13px] text-ink-muted">
                JobNimbus filing is switched off for this company. The package and status change will go out once it is turned on.
              </p>
            )}
            <ul className="flex flex-col">
              {(writes ?? []).map((write) => (
                <li key={write.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-b-0">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{WRITE_LABEL[write.kind] ?? write.kind}</span>
                    {write.outcome_detail ? <span className="block text-xs text-ink-subtle">{write.outcome_detail}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={WRITE_TONE[write.status] ?? "neutral"}>{WRITE_STATUS[write.status] ?? write.status}</Badge>
                    {write.status === "failed" ? (
                      <form action={retryCloseoutWrite}>
                        <input type="hidden" name="writeId" value={write.id} />
                        <input type="hidden" name="closeoutId" value={closeout.id} />
                        <input type="hidden" name="jobJnid" value={job.jnid} />
                        <button type="submit" className={secondaryButtonClasses}>
                          Retry
                        </button>
                      </form>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        {aside}
      </main>
    );
  }

  return (
    <main className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        {header}
        <CloseoutForm
          closeout={{
            id: closeout.id,
            version: closeout.version,
            jobJnid: job.jnid,
            installStartedOn: closeout.install_started_on,
            installCompletedOn: closeout.install_completed_on,
            crew: closeout.crew,
            squaresInstalled: closeout.squares_installed === null ? null : Number(closeout.squares_installed),
            layersRemoved: closeout.layers_removed,
            deckingSheetsReplaced: closeout.decking_sheets_replaced,
            checklist: closeout.checklist as Record<string, string>,
            punchItems: closeout.punch_items,
            productionNotes: closeout.production_notes,
            featureNote: closeout.feature_note,
            selectedPhotoJnids: closeout.selected_photo_jnids,
            homeownerUnavailableReason: closeout.homeowner_unavailable_reason,
            photosStatus: closeout.photos_status,
          }}
          signoff={
            closeout.homeowner_signed_at && closeout.homeowner_name && closeout.homeowner_outcome
              ? {
                  name: closeout.homeowner_name,
                  signedAt: closeout.homeowner_signed_at,
                  photoRelease: closeout.photo_release,
                  reviewRequestOk: Boolean(closeout.review_request_ok),
                  outcome: closeout.homeowner_outcome,
                }
              : null
          }
          suggestions={{
            installDays: suggestedDays,
            squares: prefill.roofr?.squares ? `Roofr: ${Number(prefill.roofr.squares).toFixed(1)}` : null,
          }}
          checklist={checklist}
          photos={photos}
          initialGaps={gaps}
        />
      </div>
      {aside}
    </main>
  );
}
