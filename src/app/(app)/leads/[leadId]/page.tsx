import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { buildActivityTimeline } from "@/modules/leads/activity-timeline";
import { InteractionList } from "./interaction-list";
import { ParcelMap, type ParcelMapCandidate } from "./parcel-map";
import { TaskList } from "./task-list";

function formatLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const normalized = value.replaceAll("_", " ");
  return normalized[0]?.toUpperCase() + normalized.slice(1);
}

function formatSource(value: string): string {
  return formatLabel(value).replace(/^Njgin\b/, "NJGIN");
}

function formatCents(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function EvidenceItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value ?? "—"}</dd>
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
  ]);

  if (stageHistoryError || interactionsError || tasksError) {
    throw new Error("Failed to load lead workspace");
  }
  if (addressError || parcelError || structureError) {
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

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
          Lead workspace
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {lead.name}
        </h1>
        <section
          aria-label="Contact details"
          className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-neutral-600 dark:text-neutral-300"
        >
          <p>{lead.phone}</p>
          <p>{lead.email}</p>
          <p>Stage: {formatLabel(lead.stage)}</p>
        </section>
      </header>

      <section
        aria-labelledby="property-profile-heading"
        className="mt-6 rounded-lg border border-neutral-200 p-4 sm:p-5 dark:border-neutral-800"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="property-profile-heading"
              className="text-lg font-semibold"
            >
              Property profile
            </h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {lead.properties?.canonical_address ?? lead.submitted_address}
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
            {formatLabel(lead.properties?.resolution_status)}
          </span>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <section aria-labelledby="address-evidence-heading">
            <h3 id="address-evidence-heading" className="font-medium">
              Address evidence
            </h3>
            {address ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <EvidenceItem
                  label="Validated address"
                  value={address.canonical_address}
                />
                <EvidenceItem
                  label="Match method"
                  value={formatLabel(address.match_method)}
                />
                <EvidenceItem
                  label="Confidence"
                  value={`${address.confidence}%`}
                />
                <EvidenceItem
                  label="Municipality"
                  value={address.municipality}
                />
                <EvidenceItem label="County" value={address.county} />
                <EvidenceItem
                  label="State / ZIP"
                  value={[address.state_code, address.zip]
                    .filter(Boolean)
                    .join(" ")}
                />
                <EvidenceItem
                  label="Observed"
                  value={
                    <time dateTime={address.created_at}>
                      {formatTimestamp(address.created_at)}
                    </time>
                  }
                />
              </dl>
            ) : (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
                Address validation evidence is not yet available.
              </p>
            )}
          </section>

          <section aria-labelledby="parcel-evidence-heading">
            <h3 id="parcel-evidence-heading" className="font-medium">
              Parcel evidence
            </h3>
            {parcel ? (
              <>
                <p className="mt-3 text-sm font-medium">
                  Block {parcel.block} · Lot {parcel.lot}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                  <EvidenceItem label="Qualifier" value={parcel.qualifier} />
                  <EvidenceItem label="PAMS PIN" value={parcel.pams_pin} />
                  <EvidenceItem
                    label="Municipality"
                    value={parcel.municipality_name}
                  />
                  <EvidenceItem label="County" value={parcel.county} />
                  <EvidenceItem
                    label="Property class"
                    value={parcel.property_class}
                  />
                  <EvidenceItem label="Acreage" value={parcel.acreage} />
                  <EvidenceItem label="Year built" value={parcel.year_built} />
                  <EvidenceItem
                    label="Land value"
                    value={formatCents(parcel.land_value_cents)}
                  />
                  <EvidenceItem
                    label="Improvement value"
                    value={formatCents(parcel.improvement_value_cents)}
                  />
                  <EvidenceItem
                    label="Net value"
                    value={formatCents(parcel.net_value_cents)}
                  />
                  <EvidenceItem
                    label="Building"
                    value={parcel.building_description}
                  />
                  <EvidenceItem label="Units" value={parcel.dwelling_units} />
                  <EvidenceItem
                    label="Observed"
                    value={
                      <time dateTime={parcel.created_at}>
                        {formatTimestamp(parcel.created_at)}
                      </time>
                    }
                  />
                </dl>
              </>
            ) : (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
                Parcel details are not yet available.
              </p>
            )}
          </section>

          <section aria-labelledby="structure-evidence-heading">
            <h3 id="structure-evidence-heading" className="font-medium">
              Structure evidence
            </h3>
            {structure ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <EvidenceItem
                  label="Source"
                  value={formatSource(structure.source)}
                />
                <EvidenceItem
                  label="Observed"
                  value={
                    <time dateTime={structure.created_at}>
                      {formatTimestamp(structure.created_at)}
                    </time>
                  }
                />
              </dl>
            ) : (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
                Structure details are not yet available.
              </p>
            )}
          </section>
        </div>

        {mapCandidates.length > 0 ? (
          <section
            aria-labelledby="property-map-heading"
            className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800"
          >
            <h3 id="property-map-heading" className="font-medium">
              Property map
            </h3>
            <div className="mt-3">
              <ParcelMap candidates={mapCandidates} />
            </div>
          </section>
        ) : null}
        {parcel ? (
          <p
            role="note"
            className="mt-2 text-xs text-neutral-600 dark:text-neutral-400"
          >
            Parcel geometry and public-record data are analytical aids and are
            not a legal survey, appraisal, or title report.
          </p>
        ) : null}
      </section>

      {lead.notes ? (
        <section
          aria-label="Notes"
          className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <h2 className="font-semibold">Notes</h2>
          <p className="mt-2 text-sm">{lead.notes}</p>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TaskList leadId={leadId} tasks={tasks ?? []} />
        <InteractionList leadId={leadId} interactions={interactions ?? []} />
      </div>

      <section
        aria-label="Activity"
        className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
      >
        <h2 className="font-semibold">Activity</h2>
        {timeline.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm">
            {timeline.map((item, index) => (
              <li key={index}>
                {item.kind === "stage_change"
                  ? `${item.fromStage ?? "—"} → ${item.toStage}`
                  : `${item.interactionType}: ${item.summary}`}{" "}
                ({item.occurredAt})
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            No activity has been recorded.
          </p>
        )}
      </section>
    </main>
  );
}
