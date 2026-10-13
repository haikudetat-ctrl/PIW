import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { secondaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { humanize } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import {
  boardStageFor,
  formatSyncAge,
  jobProgress,
  jobTitle,
  journeyEventLabel,
} from "@/modules/jobs/job-detail";
import { JOBNIMBUS_JOB_URL } from "@/modules/leads/jobnimbus-pipeline";

const FILES_SHOWN = 8;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function formatDollars(value: number | null): string {
  if (value === null || value === 0) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatPhone(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!digits || digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function statusTone(stage: string | null): BadgeTone {
  if (stage === "sold" || stage === "in_production" || stage === "completed") return "success";
  if (stage === "lost") return "danger";
  if (stage === "quoted") return "info";
  return "neutral";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] font-medium break-words text-ink">{value ?? "—"}</dd>
    </div>
  );
}

export default async function JobPage({ params }: { params: Promise<{ jnid: string }> }) {
  const { jnid } = await params;
  const supabase = await createServerClient();

  const { data: job, error } = await supabase
    .from("jn_jobs")
    .select(
      "jnid, number, status_name, status_changed_at, primary_contact_jnid, sales_rep_name, address_line1, city, state_text, zip, shingle_line, job_type, estimate_total, approved_total, jn_created_at, projected_at",
    )
    .eq("jnid", jnid)
    .maybeSingle();
  if (error) throw new Error("Failed to load JobNimbus job");
  if (!job) notFound();

  const [contactResult, statusResult, estimatesResult, filesResult, roofrResult, identityResult] =
    await Promise.all([
      job.primary_contact_jnid
        ? supabase
            .from("jn_contacts")
            .select("display_name, email_normalized, phone_normalized, source_name")
            .eq("jnid", job.primary_contact_jnid)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      job.status_name
        ? supabase
            .from("jobnimbus_status_stages")
            .select("company_id, stage")
            .eq("status_name", job.status_name)
        : Promise.resolve({ data: [] }),
      supabase
        .from("jn_estimates")
        .select("jnid, number, status_name, estimate_total, approved_total, jn_created_at")
        .eq("related_job_jnid", jnid)
        .order("jn_created_at", { ascending: false }),
      supabase
        .from("jn_files")
        .select("jnid, filename, jn_created_at", { count: "exact" })
        .eq("related_job_jnid", jnid)
        .order("jn_created_at", { ascending: false })
        .limit(FILES_SHOWN),
      supabase
        .from("jobnimbus_roofr_reports")
        .select("total_squares, predominant_pitch_12, facets, two_story_squares, flat_squares, processed_at")
        .eq("job_jnid", jnid)
        .eq("outcome", "ingested")
        .order("processed_at", { ascending: false })
        .limit(1),
      supabase
        .from("customer_identities")
        .select("customer_id")
        .eq("source_system", "jobnimbus_job")
        .eq("external_id", jnid)
        .maybeSingle(),
    ]);

  const contact = contactResult.data;
  // A company's own status mapping wins over the shared default.
  const statusRows = (statusResult.data ?? []) as { company_id: string | null; stage: string | null }[];
  const statusStage = (statusRows.find((row) => row.company_id !== null) ?? statusRows[0])?.stage ?? null;
  const estimates = estimatesResult.data ?? [];
  const files = filesResult.data ?? [];
  const fileCount = filesResult.count ?? files.length;
  const roofr = roofrResult.data?.[0] ?? null;

  // The customer journey ties this job to its Rake lead and its history;
  // only managers can read it, so reps see the job without the timeline.
  const customerId = identityResult.data?.customer_id ?? null;
  const [eventsResult, leadIdentityResult] = customerId
    ? await Promise.all([
        supabase
          .from("customer_journey_events")
          .select("stage, occurred_at, source_system, source_ref")
          .eq("customer_id", customerId)
          .order("occurred_at", { ascending: false }),
        supabase
          .from("customer_identities")
          .select("external_id")
          .eq("customer_id", customerId)
          .eq("source_system", "piw_lead")
          .limit(1),
      ])
    : [{ data: [] }, { data: [] }];
  const events = (eventsResult.data ?? []) as { stage: string; occurred_at: string; source_system: string; source_ref: string }[];
  const leadId = (leadIdentityResult.data ?? [])[0]?.external_id ?? null;

  const progress = jobProgress(statusStage, events);
  const value = job.approved_total && Number(job.approved_total) > 0 ? Number(job.approved_total) : Number(job.estimate_total ?? 0);
  const name = contact?.display_name?.trim() || null;
  const address = [job.address_line1, job.city].map((part) => part?.trim()).filter(Boolean).join(", ");
  const fullAddress = [address, [job.state_text, job.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const jobnimbusUrl = `${JOBNIMBUS_JOB_URL}${encodeURIComponent(job.jnid)}`;
  const phone = formatPhone(contact?.phone_normalized ?? null);

  return (
    <main className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px]">
          <Link href="/pipeline" className="text-tint hover:underline">Pipeline</Link>
          <Icon name="chevronRight" size={14} className="text-ink-subtle" />
          <span className="text-ink-muted">
            {[job.number ? `#${job.number}` : null, name].filter(Boolean).join(" · ") || "JobNimbus job"}
          </span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] font-bold tracking-tight text-ink">{jobTitle(job)}</h1>
              {job.status_name ? <Badge tone={statusTone(statusStage)}>{job.status_name}</Badge> : null}
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">
              {[name, address || null, job.shingle_line, value > 0 ? formatDollars(value) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-ink-muted">
              <Icon name="check" size={13} />
              Synced from JobNimbus · {formatSyncAge(job.projected_at, new Date())}
            </span>
            {leadId ? (
              <Link href={`/leads/${leadId}`} className={secondaryButtonClasses}>
                Open Rake lead
              </Link>
            ) : null}
            <a href={jobnimbusUrl} target="_blank" rel="noreferrer" className={secondaryButtonClasses}>
              Open in JobNimbus
            </a>
          </div>
        </div>

        <section aria-label="Progress" className="rounded-2xl bg-surface px-5 py-4 shadow-card">
          <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
            {progress.map((step, index) => (
              <li key={step.key} className="relative flex flex-col gap-1 pr-2">
                <div className="flex items-center">
                  <span
                    aria-hidden
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      step.state === "done"
                        ? "border-success bg-success text-white"
                        : step.state === "current"
                          ? "border-tint bg-surface"
                          : "border-border-strong bg-surface"
                    }`}
                  >
                    {step.state === "done" ? <Icon name="check" size={11} /> : null}
                    {step.state === "current" ? <span className="size-2 rounded-full bg-tint" /> : null}
                  </span>
                  {index < progress.length - 1 ? (
                    <span
                      aria-hidden
                      className={`ml-1 h-0.5 flex-1 ${step.state === "done" ? "bg-success" : "bg-border"}`}
                    />
                  ) : null}
                </div>
                <span className={`text-[13px] font-medium ${step.state === "upcoming" ? "text-ink-muted" : "text-ink"}`}>
                  {step.label}
                  {step.state === "current" ? <span className="sr-only"> (current)</span> : null}
                </span>
                <span className={`text-xs ${step.state === "current" ? "text-tint" : "text-ink-subtle"}`}>
                  {step.date ? formatDate(step.date) : step.state === "upcoming" ? "—" : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Card title="Job" right={<Badge tone="neutral">{humanize(boardStageFor(statusStage, job.status_name))}</Badge>}>
            <dl>
              <Row label="Job #" value={job.number} />
              <Row label="Status" value={job.status_name} />
              <Row label="Status changed" value={formatDate(job.status_changed_at)} />
              <Row label="Sales rep" value={job.sales_rep_name ?? "Unassigned"} />
              <Row label="Job type" value={job.job_type} />
              <Row label="Created" value={formatDate(job.jn_created_at)} />
            </dl>
          </Card>

          <Card
            title="Roof measurement"
            right={roofr ? <Badge tone="success">Roofr</Badge> : <Badge tone="neutral">None yet</Badge>}
          >
            {roofr ? (
              <dl>
                <Row label="Total" value={`${Number(roofr.total_squares).toFixed(1)} sq`} />
                <Row
                  label="Predominant pitch"
                  value={roofr.predominant_pitch_12 === null ? null : `${Number(roofr.predominant_pitch_12)}/12`}
                />
                <Row label="Facets" value={roofr.facets} />
                <Row
                  label="Two-story"
                  value={roofr.two_story_squares === null ? null : `${Number(roofr.two_story_squares).toFixed(1)} sq`}
                />
                <Row label="Flat" value={roofr.flat_squares === null ? null : `${Number(roofr.flat_squares).toFixed(1)} sq`} />
                <Row label="Read" value={formatDate(roofr.processed_at)} />
              </dl>
            ) : (
              <p className="text-sm text-ink-subtle">
                No Roofr report on this job. Reports attached in JobNimbus are read after the hourly sync.
              </p>
            )}
          </Card>

          <Card title="Estimates" right={`${estimates.length}`}>
            {estimates.length > 0 ? (
              <dl>
                {estimates.map((estimate) => (
                  <Row
                    key={estimate.jnid}
                    label={`${estimate.number ? `#${estimate.number}` : "Estimate"} · ${formatDate(estimate.jn_created_at)}`}
                    value={
                      <span className="inline-flex items-center gap-2">
                        {estimate.status_name ? (
                          <Badge tone={estimate.status_name === "Approved" ? "success" : estimate.status_name === "Void" ? "danger" : "neutral"}>
                            {estimate.status_name}
                          </Badge>
                        ) : null}
                        {formatDollars(
                          Number(estimate.approved_total ?? 0) > 0
                            ? Number(estimate.approved_total)
                            : estimate.estimate_total === null
                              ? null
                              : Number(estimate.estimate_total),
                        )}
                      </span>
                    }
                  />
                ))}
              </dl>
            ) : (
              <p className="text-sm text-ink-subtle">No estimates in JobNimbus yet.</p>
            )}
          </Card>

          <Card title="Files" right={`${fileCount}`}>
            {files.length > 0 ? (
              <ul className="flex flex-col">
                {files.map((file) => (
                  <li
                    key={file.jnid}
                    className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-[13px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-ink">{file.filename ?? "Untitled file"}</span>
                    <span className="shrink-0 text-xs text-ink-subtle">{formatDate(file.jn_created_at)}</span>
                  </li>
                ))}
                {fileCount > files.length ? (
                  <li className="pt-2 text-xs text-ink-subtle">
                    +{(fileCount - files.length).toLocaleString()} more in JobNimbus
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="text-sm text-ink-subtle">No files on this job.</p>
            )}
          </Card>
        </div>
      </div>

      <aside aria-label="Customer and activity" className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-6">
        <Card title="Customer">
          <p className="text-sm font-medium text-ink">{name ?? "No contact on this job"}</p>
          <ul className="mt-2 flex flex-col gap-2 text-[13px] text-ink-muted">
            {phone ? (
              <li>
                <a href={`tel:${contact?.phone_normalized}`} className="inline-flex items-center gap-2 hover:text-ink">
                  <Icon name="phone" size={14} className="text-ink-subtle" />
                  {phone}
                </a>
              </li>
            ) : null}
            {contact?.email_normalized ? (
              <li>
                <a href={`mailto:${contact.email_normalized}`} className="inline-flex items-center gap-2 hover:text-ink">
                  <Icon name="mail" size={14} className="text-ink-subtle" />
                  {contact.email_normalized}
                </a>
              </li>
            ) : null}
            {fullAddress ? (
              <li className="inline-flex items-center gap-2">
                <Icon name="route" size={14} className="text-ink-subtle" />
                {fullAddress}
              </li>
            ) : null}
            {contact?.source_name ? (
              <li className="inline-flex items-center gap-2">
                <Icon name="sparkle" size={14} className="text-ink-subtle" />
                Source: {contact.source_name}
              </li>
            ) : null}
          </ul>
        </Card>

        <Card title="Activity">
          {events.length > 0 ? (
            <ul className="flex flex-col">
              {events.map((event) => (
                <li key={`${event.stage}-${event.source_system}-${event.source_ref}`} className="flex gap-2.5 py-1.5 text-[13px] text-ink">
                  <span
                    aria-hidden
                    className={`mt-1.5 size-[7px] shrink-0 rounded-full ${
                      event.stage === "sold" || event.stage === "completed"
                        ? "bg-success"
                        : event.stage === "lost"
                          ? "bg-danger"
                          : "bg-tint"
                    }`}
                  />
                  <span>
                    {journeyEventLabel(event.stage)}
                    {event.source_system === "piw_lead" ? " · Rake" : ""}
                    <span className="block text-xs text-ink-subtle">{formatDate(event.occurred_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-subtle">No activity recorded yet.</p>
          )}
        </Card>
      </aside>
    </main>
  );
}
