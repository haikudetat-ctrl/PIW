import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDateTime, humanize } from "@/lib/format";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{value ?? "—"}</dd>
    </div>
  );
}

const OUTCOME_TONE: Record<string, BadgeTone> = {
  ready: "success",
  complete: "success",
  completed: "success",
  sent: "success",
  pending: "info",
  queued: "info",
  estimating: "info",
  failed: "danger",
  no_coverage: "warning",
  quota_exhausted: "warning",
  review_required: "warning",
};

export default async function ContextDialerPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const supabase = await createServerClient();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(
      "id, company_id, property_id, name, phone, phone_e164, email, submitted_address, service_requested, notes, stage, source_system, original_lead_source, campaign, consent_reference, trustedform_url, created_at, properties(canonical_address, resolution_status)",
    )
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw new Error("Failed to load Context Dialer lead");
  if (!lead) notFound();

  const { data: pipeline } = await supabase
    .from("pipeline_runs")
    .select("id, status, correlation_id, started_at, finished_at")
    .eq("company_id", lead.company_id)
    .eq("lead_id", lead.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const noResult = Promise.resolve({ data: null, error: null });
  const noRows = Promise.resolve({ data: [], error: null });
  const [
    { data: address, error: addressError },
    { data: estimate, error: estimateError },
    { data: consents, error: consentError },
    { data: workers, error: workerError },
    { data: providerRequests, error: providerError },
    { data: tasks, error: taskError },
    { data: slackDelivery, error: slackError },
  ] = await Promise.all([
    lead.property_id
      ? supabase
          .from("property_addresses")
          .select("canonical_address, match_method, confidence, municipality, county, state_code, zip, latitude, longitude, created_at")
          .eq("company_id", lead.company_id)
          .eq("property_id", lead.property_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : noResult,
    supabase
      .from("roof_estimates")
      .select("id, roof_insight_id, status, total_roof_sqft, roof_squares, range_low_cents, range_high_cents, pricing_version, assumptions, failure_reason, updated_at")
      .eq("company_id", lead.company_id)
      .eq("lead_id", lead.id)
      .maybeSingle(),
    supabase
      .from("lead_consents")
      .select("consent_type, granted, disclosure_version, source, granted_at")
      .eq("company_id", lead.company_id)
      .eq("lead_id", lead.id)
      .order("consent_type"),
    pipeline
      ? supabase
          .from("worker_runs")
          .select("worker_type, status, attempt_count, error, started_at, finished_at")
          .eq("pipeline_run_id", pipeline.id)
          .order("started_at")
      : noRows,
    pipeline
      ? supabase
          .from("provider_requests")
          .select("capability, provider, status, attempt, error_code, error_message, requested_at, completed_at")
          .eq("company_id", lead.company_id)
          .eq("pipeline_run_id", pipeline.id)
          .order("requested_at")
      : noRows,
    supabase
      .from("tasks")
      .select("id, title, status, due_at")
      .eq("company_id", lead.company_id)
      .eq("lead_id", lead.id)
      .order("created_at"),
    pipeline
      ? supabase
          .from("context_dialer_deliveries")
          .select("status, attempt_count, sent_at, failure_reason, updated_at")
          .eq("company_id", lead.company_id)
          .eq("pipeline_run_id", pipeline.id)
          .maybeSingle()
      : noResult,
  ]);
  if (
    addressError ||
    estimateError ||
    consentError ||
    workerError ||
    providerError ||
    taskError ||
    slackError
  ) {
    throw new Error("Failed to load Context Dialer intelligence");
  }

  const { data: insight, error: insightError } = estimate?.roof_insight_id
    ? await supabase
        .from("roof_insights")
        .select("provider, building_name, lookup_status, imagery_date, imagery_quality, plane_count, total_roof_sqft, roof_segments, source_retrieved_at")
        .eq("company_id", lead.company_id)
        .eq("id", estimate.roof_insight_id)
        .maybeSingle()
    : { data: null, error: null };
  if (insightError) throw new Error("Failed to load Google roof intelligence");

  const canonicalAddress =
    address?.canonical_address ??
    lead.properties?.canonical_address ??
    lead.submitted_address;
  const source = lead.campaign ?? lead.original_lead_source ?? lead.source_system ?? "Direct";

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-ink-subtle uppercase">
            Context Dialer
          </p>
          <h1 className="mt-1 text-3xl font-bold text-ink">{lead.name}</h1>
          <p className="mt-2 text-sm text-ink-muted">{canonicalAddress}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`tel:${lead.phone_e164 ?? lead.phone}`}
            className="rounded-md bg-accent px-5 py-3 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Call {lead.phone}
          </a>
          <a
            href={`mailto:${lead.email}`}
            className="rounded-md border border-border-strong bg-surface px-5 py-3 text-sm font-semibold text-ink"
          >
            Email lead
          </a>
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.8fr)]">
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="relative aspect-[16/10] bg-surface-muted">
            <Image
              src={`/api/context-dialer/${lead.id}/house-image`}
              alt={`Satellite view of ${canonicalAddress}`}
              fill
              priority
              unoptimized
              sizes="(min-width: 1024px) 65vw, 100vw"
              className="object-cover"
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3 text-xs text-ink-subtle">
            <span>Google satellite imagery · verify conditions during inspection</span>
            <span>{insight?.imagery_date ? `Captured ${insight.imagery_date}` : "Current imagery date unavailable"}</span>
          </div>
        </div>

        <Card title="Call context" ariaLabel="Call context">
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
            <Fact label="Lead stage" value={humanize(lead.stage)} />
            <Fact label="Source" value={source} />
            <Fact label="Submitted" value={formatDateTime(lead.created_at)} />
            <Fact label="Service" value={humanize(lead.service_requested)} />
            <Fact label="Phone" value={lead.phone} />
            <Fact label="Email" value={lead.email} />
            <Fact label="Campaign" value={lead.campaign} />
            <Fact label="Resolution" value={humanize(lead.properties?.resolution_status ?? "unresolved")} />
          </dl>
          {lead.notes ? (
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">Lead notes</p>
              <p className="mt-2 text-sm leading-6 text-ink">{lead.notes}</p>
            </div>
          ) : null}
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Roof estimate"
          ariaLabel="Roof estimate"
          right={estimate ? <Badge tone={OUTCOME_TONE[estimate.status]}>{humanize(estimate.status)}</Badge> : null}
        >
          {estimate?.status === "ready" ? (
            <>
              <p className="text-3xl font-bold text-ink">
                {formatCurrency(estimate.range_low_cents)}–{formatCurrency(estimate.range_high_cents)}
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {Number(estimate.roof_squares).toFixed(1)} squares · {Math.round(Number(estimate.total_roof_sqft)).toLocaleString()} sq ft · New Jersey average pricing
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              {estimate?.failure_reason ?? "Roof intelligence is still processing."}
            </p>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4">
            <Fact label="Google status" value={humanize(insight?.lookup_status ?? "pending")} />
            <Fact label="Imagery quality" value={insight?.imagery_quality} />
            <Fact label="Roof planes" value={insight?.plane_count} />
            <Fact label="Pricing model" value={estimate?.pricing_version} />
            <Fact label="Measured" value={insight?.source_retrieved_at ? formatDateTime(insight.source_retrieved_at) : null} />
            <Fact label="Provider" value={insight?.provider ? humanize(insight.provider) : null} />
          </dl>
        </Card>

        <Card
          title="Validated property"
          ariaLabel="Validated property"
          right={address ? <Badge tone="success">{address.confidence}% match</Badge> : null}
        >
          <p className="text-sm font-semibold text-ink">{canonicalAddress}</p>
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <Fact label="Match method" value={address?.match_method ? humanize(address.match_method) : null} />
            <Fact label="Municipality" value={address?.municipality} />
            <Fact label="County" value={address?.county} />
            <Fact label="State / ZIP" value={[address?.state_code, address?.zip].filter(Boolean).join(" ")} />
            <Fact label="Latitude" value={address?.latitude} />
            <Fact label="Longitude" value={address?.longitude} />
          </dl>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Consent and attribution" ariaLabel="Consent and attribution">
          <dl className="grid grid-cols-2 gap-4">
            {(consents ?? []).map((consent) => (
              <Fact
                key={consent.consent_type}
                label={humanize(consent.consent_type)}
                value={`${consent.granted ? "Granted" : "Not granted"} · ${formatDateTime(consent.granted_at)}`}
              />
            ))}
            <Fact label="Consent reference" value={lead.consent_reference} />
            <Fact
              label="TrustedForm"
              value={lead.trustedform_url ? <a className="underline" href={lead.trustedform_url}>Open certificate</a> : null}
            />
          </dl>
        </Card>

        <Card
          title="Workflow status"
          ariaLabel="Workflow status"
          right={pipeline ? <Badge tone={OUTCOME_TONE[pipeline.status]}>{humanize(pipeline.status)}</Badge> : null}
        >
          <div className="space-y-3">
            {(workers ?? []).map((worker) => (
              <div key={`${worker.worker_type}-${worker.started_at}`} className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-ink">{humanize(worker.worker_type)}</p>
                  <p className="text-xs text-ink-subtle">
                    {worker.started_at ? `Started ${formatDateTime(worker.started_at)}` : "Not started"}
                  </p>
                </div>
                <Badge tone={OUTCOME_TONE[worker.status]}>{humanize(worker.status)}</Badge>
              </div>
            ))}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4">
            <Fact label="Slack handoff" value={slackDelivery ? humanize(slackDelivery.status) : "Not queued"} />
            <Fact label="Slack attempts" value={slackDelivery?.attempt_count ?? 0} />
            <Fact label="Open tasks" value={(tasks ?? []).filter((task) => task.status !== "complete").length} />
            <Fact label="Provider calls" value={(providerRequests ?? []).length} />
          </dl>
          {slackDelivery?.failure_reason ? (
            <p className="mt-4 rounded-md bg-danger-bg p-3 text-sm text-danger">{slackDelivery.failure_reason}</p>
          ) : null}
        </Card>
      </section>

      <div className="flex items-center justify-between border-t border-border pt-5 text-sm">
        <Link className="font-medium text-accent underline" href={`/leads/${lead.id}`}>
          Open full lead workspace
        </Link>
        <span className="text-ink-subtle">Correlation {pipeline?.correlation_id ?? "not assigned"}</span>
      </div>
    </main>
  );
}
