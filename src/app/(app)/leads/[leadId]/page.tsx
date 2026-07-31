import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { buildActivityTimeline } from "@/modules/leads/activity-timeline";
import { InteractionList } from "./interaction-list";
import { ParcelMap, type ParcelMapCandidate } from "./parcel-map";
import { TaskList } from "./task-list";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatCurrency, formatDateTime, formatSource, humanize, sentenceCase } from "@/lib/format";

const RESOLUTION_TONE: Record<string, BadgeTone> = {
  resolved: "success",
  unresolved: "neutral",
  review_required: "warning",
  duplicate: "info",
  unsupported: "danger",
};

function EvidenceItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value ?? "—"}</dd>
    </div>
  );
}

export default async function LeadWorkspacePage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const supabase = await createServerClient();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(
      "id, company_id, name, phone, email, submitted_address, notes, stage, property_id, properties(canonical_address, resolution_status)",
    )
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) throw new Error("Failed to load lead workspace");
  if (!lead) notFound();

  const companyId = lead.company_id;
  const propertyId = lead.property_id;
  const noProperty = Promise.resolve({ data: null, error: null });
  const [
    { data: stageHistory, error: stageHistoryError },
    { data: interactions, error: interactionsError },
    { data: tasks, error: tasksError },
    { data: address, error: addressError },
    { data: parcel, error: parcelError },
    { data: structure, error: structureError },
    { data: estimate, error: estimateError },
    { data: deliveries, error: deliveriesError },
  ] = await Promise.all([
    supabase
      .from("lead_stage_history")
      .select("changed_at, from_stage, to_stage")
      .eq("company_id", companyId)
      .eq("lead_id", leadId),
    supabase
      .from("interactions")
      .select("id, occurred_at, type, summary")
      .eq("company_id", companyId)
      .eq("lead_id", leadId),
    supabase
      .from("tasks")
      .select("id, title, due_at, status")
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .order("created_at"),
    propertyId
      ? supabase
          .from("property_addresses")
          .select(
            "canonical_address, submitted_address, match_method, confidence, municipality, county, state_code, zip, latitude, longitude, created_at",
          )
          .eq("company_id", companyId)
          .eq("property_id", propertyId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : noProperty,
    propertyId
      ? supabase
          .from("parcels")
          .select(
            "id, block, lot, qualifier, pams_pin, municipality_name, county, property_class, acreage, year_built, land_value_cents, improvement_value_cents, net_value_cents, street_address, building_description, dwelling_units, geometry, created_at",
          )
          .eq("company_id", companyId)
          .eq("property_id", propertyId)
          .eq("is_primary", true)
          .maybeSingle()
      : noProperty,
    propertyId
      ? supabase
          .from("structures")
          .select("source, footprint_geometry, created_at")
          .eq("company_id", companyId)
          .eq("property_id", propertyId)
          .eq("is_primary", true)
          .maybeSingle()
      : noProperty,
    supabase
      .from("roof_estimates")
      .select("status, total_roof_sqft, roof_squares, range_low_cents, range_high_cents, pricing_version, failure_reason, updated_at")
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .maybeSingle(),
    supabase
      .from("estimate_deliveries")
      .select("channel, destination, status, sent_at, failure_reason")
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .order("channel"),
  ]);

  if (stageHistoryError || interactionsError || tasksError) {
    throw new Error("Failed to load lead workspace");
  }
  if (addressError || parcelError || structureError || estimateError || deliveriesError) {
    throw new Error("Failed to load property profile");
  }

  const timeline = buildActivityTimeline(stageHistory ?? [], interactions ?? []);
  const mapCandidates: ParcelMapCandidate[] = [];
  if (parcel?.geometry) {
    mapCandidates.push({
      geometry: parcel.geometry,
      label: "Parcel boundary",
    });
  }
  if (structure?.footprint_geometry) {
    mapCandidates.push({
      geometry: structure.footprint_geometry,
      label: "Structure footprint",
    });
  }
  if (
    address &&
    typeof address.latitude === "number" &&
    typeof address.longitude === "number"
  ) {
    mapCandidates.push({
      geometry: null,
      label: address.canonical_address ?? address.submitted_address,
      latitude: address.latitude,
      longitude: address.longitude,
    });
  }

  const resolutionStatus = lead.properties?.resolution_status ?? "unresolved";

  return (
    <main className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-ink-subtle uppercase">
          Lead workspace
        </p>
        <h1 className="mt-1 text-2xl font-bold text-ink">{lead.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-muted">
          <p>{lead.phone}</p>
          <p>{lead.email}</p>
          <p>Stage: {humanize(lead.stage)}</p>
        </div>
      </div>

      {estimate ? (
        <Card
          title="Preliminary roof estimate"
          ariaLabel="Preliminary roof estimate"
          right={
            <Badge tone={estimate.status === "ready" ? "success" : estimate.status === "pending" ? "info" : "warning"}>
              {humanize(estimate.status)}
            </Badge>
          }
        >
          {estimate.status === "ready" ? (
            <>
              <p className="text-2xl font-bold text-ink">
                {formatCurrency(estimate.range_low_cents)}–{formatCurrency(estimate.range_high_cents)}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {Number(estimate.roof_squares).toFixed(1)} roofing squares · {Math.round(Number(estimate.total_roof_sqft)).toLocaleString()} sq ft · NJ average pricing
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              {estimate.failure_reason ?? "Google roof measurement is still processing."}
            </p>
          )}
          <dl className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            {(deliveries ?? []).map((delivery) => (
                <EvidenceItem
                  key={delivery.channel}
                label={`${delivery.channel} delivery`}
                value={
                  <span>
                    {humanize(delivery.status)} · {delivery.destination}
                    {delivery.sent_at ? ` · ${formatDateTime(delivery.sent_at)}` : ""}
                    {delivery.failure_reason ? ` · ${delivery.failure_reason}` : ""}
                  </span>
                }
              />
            ))}
          </dl>
          <p role="note" className="mt-4 text-xs text-ink-subtle">
            Preliminary range only. Confirm measurements, materials, access, decking, and permits before quoting.
          </p>
        </Card>
      ) : null}

      <Card
        title="Property profile"
        ariaLabel="Property profile"
        right={<Badge tone={RESOLUTION_TONE[resolutionStatus]}>{humanize(resolutionStatus)}</Badge>}
      >
        <p className="text-sm text-ink-muted">
          {lead.properties?.canonical_address ?? lead.submitted_address}
        </p>

        <div className="mt-5 grid gap-6 lg:grid-cols-3">
          <section aria-labelledby="address-evidence-heading">
            <h3
              id="address-evidence-heading"
              className="text-xs font-semibold tracking-wider text-ink uppercase"
            >
              Address evidence
            </h3>
            {address ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <EvidenceItem label="Validated address" value={address.canonical_address} />
                <EvidenceItem label="Match method" value={sentenceCase(address.match_method)} />
                <EvidenceItem label="Confidence" value={`${address.confidence}%`} />
                <EvidenceItem label="Municipality" value={address.municipality} />
                <EvidenceItem label="County" value={address.county} />
                <EvidenceItem
                  label="State / ZIP"
                  value={[address.state_code, address.zip].filter(Boolean).join(" ")}
                />
                <EvidenceItem
                  label="Observed"
                  value={
                    <time dateTime={address.created_at}>
                      {formatDateTime(address.created_at)}
                    </time>
                  }
                />
              </dl>
            ) : (
              <p className="mt-3 text-sm text-ink-subtle">
                Address validation evidence is not yet available.
              </p>
            )}
          </section>

          <section aria-labelledby="parcel-evidence-heading">
            <h3
              id="parcel-evidence-heading"
              className="text-xs font-semibold tracking-wider text-ink uppercase"
            >
              Parcel evidence
            </h3>
            {parcel ? (
              <>
                <p className="mt-3 text-sm font-medium text-ink">
                  Block {parcel.block} · Lot {parcel.lot}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                  <EvidenceItem label="Qualifier" value={parcel.qualifier} />
                  <EvidenceItem label="PAMS PIN" value={parcel.pams_pin} />
                  <EvidenceItem label="Municipality" value={parcel.municipality_name} />
                  <EvidenceItem label="County" value={parcel.county} />
                  <EvidenceItem label="Property class" value={parcel.property_class} />
                  <EvidenceItem label="Acreage" value={parcel.acreage} />
                  <EvidenceItem label="Year built" value={parcel.year_built} />
                  <EvidenceItem label="Land value" value={formatCurrency(parcel.land_value_cents)} />
                  <EvidenceItem
                    label="Improvement value"
                    value={formatCurrency(parcel.improvement_value_cents)}
                  />
                  <EvidenceItem label="Net value" value={formatCurrency(parcel.net_value_cents)} />
                  <EvidenceItem label="Building" value={parcel.building_description} />
                  <EvidenceItem label="Units" value={parcel.dwelling_units} />
                  <EvidenceItem
                    label="Observed"
                    value={
                      <time dateTime={parcel.created_at}>
                        {formatDateTime(parcel.created_at)}
                      </time>
                    }
                  />
                </dl>
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-subtle">
                Parcel details are not yet available.
              </p>
            )}
          </section>

          <section aria-labelledby="structure-evidence-heading">
            <h3
              id="structure-evidence-heading"
              className="text-xs font-semibold tracking-wider text-ink uppercase"
            >
              Structure evidence
            </h3>
            {structure ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <EvidenceItem label="Source" value={formatSource(structure.source)} />
                <EvidenceItem
                  label="Observed"
                  value={
                    <time dateTime={structure.created_at}>
                      {formatDateTime(structure.created_at)}
                    </time>
                  }
                />
              </dl>
            ) : (
              <p className="mt-3 text-sm text-ink-subtle">
                Structure details are not yet available.
              </p>
            )}
          </section>
        </div>

        {mapCandidates.length > 0 ? (
          <section aria-labelledby="property-map-heading" className="mt-6 border-t border-border pt-5">
            <h3
              id="property-map-heading"
              className="text-xs font-semibold tracking-wider text-ink uppercase"
            >
              Property map
            </h3>
            <div className="mt-3">
              <ParcelMap candidates={mapCandidates} />
            </div>
          </section>
        ) : null}
        {parcel ? (
          <p role="note" className="mt-3 text-xs text-ink-subtle">
            Parcel geometry and public-record data are analytical aids and are not a legal
            survey, appraisal, or title report.
          </p>
        ) : null}
      </Card>

      {lead.notes ? (
        <Card title="Notes" ariaLabel="Notes">
          <p className="text-sm text-ink">{lead.notes}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <TaskList leadId={leadId} tasks={tasks ?? []} />
        <InteractionList leadId={leadId} interactions={interactions ?? []} />
      </div>

      <Card title="Activity" ariaLabel="Activity">
        {timeline.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {timeline.map((item, index) => (
              <li key={index} className="py-2 text-sm text-ink first:pt-0 last:pb-0">
                <span>
                  {item.kind === "stage_change"
                    ? `${item.fromStage ? humanize(item.fromStage) : "—"} → ${humanize(item.toStage)}`
                    : `${humanize(item.interactionType)}: ${item.summary}`}
                </span>{" "}
                <span className="text-ink-subtle">
                  ({formatDateTime(item.occurredAt)})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-subtle">No activity has been recorded.</p>
        )}
      </Card>
    </main>
  );
}
