import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ParcelMap, type ParcelMapCandidate } from "./parcel-map";
import {
  markReviewTaskUnsupported,
  rejectReviewTask,
  resolveReviewTask,
  retryReviewTask,
} from "./review-actions";
import { ReviewSubmitButton } from "./review-submit-button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime, formatSource, humanize, sentenceCase } from "@/lib/format";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMoney(value: unknown): string | null {
  const amount = number(value);
  return amount === null ? null : formatCurrency(amount * 100);
}

const textareaClasses =
  "mt-1 block w-full rounded-md border border-border-strong bg-surface p-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60";

type ParcelCandidate = {
  block: string;
  lot: string;
  qualifier: string | null;
  municipalityName: string | null;
  county: string | null;
  propertyClass: string | null;
  acreage: number | null;
  yearBuilt: number | null;
  landValue: number | null;
  improvementValue: number | null;
  netValue: number | null;
  streetAddress: string | null;
  buildingDescription: string | null;
  dwellingUnits: number | null;
  geometry: unknown;
};

function parcelCandidatesFrom(value: unknown): ParcelCandidate[] {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return [];
  return value.candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const block = text(candidate.block);
    const lot = text(candidate.lot);
    if (!block || !lot) return [];
    return [
      {
        block,
        lot,
        qualifier: text(candidate.qualifier),
        municipalityName: text(candidate.municipalityName),
        county: text(candidate.county),
        propertyClass: text(candidate.propertyClass),
        acreage: number(candidate.acreage),
        yearBuilt: number(candidate.yearBuilt),
        landValue: number(candidate.landValue),
        improvementValue: number(candidate.improvementValue),
        netValue: number(candidate.netValue),
        streetAddress: text(candidate.streetAddress),
        buildingDescription: text(candidate.buildingDescription),
        dwellingUnits: number(candidate.dwellingUnits),
        geometry: candidate.geometry,
      },
    ];
  });
}

function duplicateIdsFrom(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.candidatePropertyIds)) {
    return [];
  }
  return value.candidatePropertyIds.filter(
    (candidate): candidate is string => typeof candidate === "string",
  );
}

function addressResultFrom(value: unknown): UnknownRecord | null {
  if (!isRecord(value) || !isRecord(value.result)) return null;
  return value.result;
}

function EvidenceItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

export default async function ReviewTaskPage({
  params,
}: {
  params: Promise<{ reviewTaskId: string }>;
}) {
  const { reviewTaskId } = await params;
  const supabase = await createServerClient();
  const { data: task, error } = await supabase
    .from("review_tasks")
    .select(
      "id, reason, status, candidate_data, retry_count, resolution_notes, created_at, lead_id, property_id, pipeline_run_id, triggering_event_name, leads(name, submitted_address)",
    )
    .eq("id", reviewTaskId)
    .maybeSingle();

  if (error) throw new Error("Failed to load review task");
  if (!task) notFound();

  const parcelCandidates = parcelCandidatesFrom(task.candidate_data);
  const duplicateIds = duplicateIdsFrom(task.candidate_data);
  const addressResult = addressResultFrom(task.candidate_data);
  const noRows = Promise.resolve({ data: [], error: null });
  const [
    { data: duplicateProperties, error: duplicatePropertiesError },
    { data: duplicateAddresses, error: duplicateAddressesError },
    { data: duplicateParcels, error: duplicateParcelsError },
    { data: taskProviderRequests, error: taskProviderRequestsError },
  ] = await Promise.all([
    duplicateIds.length > 0
      ? supabase
          .from("properties")
          .select("id, canonical_address, municipality, county")
          .in("id", duplicateIds)
      : noRows,
    duplicateIds.length > 0
      ? supabase
          .from("property_addresses")
          .select(
            "property_id, canonical_address, latitude, longitude, provider_request_id, created_at",
          )
          .in("property_id", duplicateIds)
          .order("created_at", { ascending: false })
      : noRows,
    duplicateIds.length > 0
      ? supabase
          .from("parcels")
          .select(
            "property_id, block, lot, geometry, provider_request_id, created_at",
          )
          .in("property_id", duplicateIds)
          .eq("is_primary", true)
      : noRows,
    supabase
      .from("provider_requests")
      .select("id, provider, requested_at, completed_at")
      .eq("pipeline_run_id", task.pipeline_run_id)
      .order("requested_at", { ascending: false }),
  ]);

  if (
    duplicatePropertiesError ||
    duplicateAddressesError ||
    duplicateParcelsError ||
    taskProviderRequestsError
  ) {
    throw new Error("Failed to load review task evidence");
  }

  const duplicateProviderRequestIds = [
    ...(duplicateAddresses ?? []),
    ...(duplicateParcels ?? []),
  ].flatMap((observation) =>
    observation.provider_request_id ? [observation.provider_request_id] : [],
  );
  const {
    data: duplicateProviderRequests,
    error: duplicateProviderRequestsError,
  } =
    duplicateProviderRequestIds.length > 0
      ? await supabase
          .from("provider_requests")
          .select("id, provider, requested_at, completed_at")
          .in("id", duplicateProviderRequestIds)
      : { data: [], error: null };
  if (duplicateProviderRequestsError) {
    throw new Error("Failed to load review task evidence");
  }

  const duplicatesById = new Map(
    (duplicateProperties ?? []).map((property) => [property.id, property]),
  );
  const duplicateAddressesByProperty = new Map<
    string,
    NonNullable<typeof duplicateAddresses>[number]
  >();
  for (const address of duplicateAddresses ?? []) {
    if (!duplicateAddressesByProperty.has(address.property_id)) {
      duplicateAddressesByProperty.set(address.property_id, address);
    }
  }
  const duplicateParcelsByProperty = new Map(
    (duplicateParcels ?? []).map((parcel) => [parcel.property_id, parcel]),
  );
  const providerRequestsById = new Map(
    [...(taskProviderRequests ?? []), ...(duplicateProviderRequests ?? [])].map(
      (request) => [request.id, request],
    ),
  );
  const providerRequests = Array.from(providerRequestsById.values()).sort(
    (left, right) =>
      (right.completed_at ?? right.requested_at).localeCompare(
        left.completed_at ?? left.requested_at,
      ),
  );
  const selectableCandidates =
    parcelCandidates.length > 0 ? parcelCandidates : duplicateIds;
  const mapCandidates: ParcelMapCandidate[] = parcelCandidates.map(
    (candidate) => ({
      geometry: candidate.geometry,
      label: `Block ${candidate.block} · Lot ${candidate.lot}`,
    }),
  );
  if (addressResult) {
    mapCandidates.push({
      geometry: null,
      label:
        text(addressResult.canonicalAddress) ??
        task.leads?.submitted_address ??
        "Submitted address",
      latitude: number(addressResult.latitude),
      longitude: number(addressResult.longitude),
    });
  }
  duplicateIds.forEach((propertyId, index) => {
    const property = duplicatesById.get(propertyId);
    const address = duplicateAddressesByProperty.get(propertyId);
    const parcel = duplicateParcelsByProperty.get(propertyId);
    const canonicalAddress =
      address?.canonical_address ??
      property?.canonical_address ??
      "Canonical address unavailable";
    mapCandidates.push({
      geometry: parcel?.geometry ?? null,
      label: [
        `Candidate ${index + 1}`,
        canonicalAddress,
        parcel ? `Block ${parcel.block} · Lot ${parcel.lot}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      latitude: address?.latitude,
      longitude: address?.longitude,
    });
  });
  const isOpen = task.status === "open";
  const resolveConsequence =
    task.reason === "duplicate_candidates"
      ? "Completes the pipeline; a selected candidate re-links this lead to that existing property."
      : parcelCandidates.length > 0
        ? "Resolves this property and completes the pipeline; a selected parcel is saved as primary."
        : "Accepts this evidence, resolves the property, and completes the pipeline.";
  const retryConsequence =
    task.triggering_event_name === "property/address.validation_requested"
      ? "Reopens this property and pipeline, then queues a new address-validation attempt."
      : "Reopens this property and pipeline, then queues a new property-discovery attempt.";

  return (
    <main className="flex flex-col gap-6">
      <div>
        <Link href="/review" className="text-sm font-medium text-accent hover:underline">
          ← Review queue
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-xs font-semibold tracking-widest text-ink-subtle uppercase">
            {humanize(task.reason)}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-ink">Review property match</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {task.leads?.name ?? "Unknown lead"} ·{" "}
            {task.leads?.submitted_address ?? "No submitted address"}
          </p>
        </div>
        <Badge tone={isOpen ? "warning" : "neutral"}>{humanize(task.status)}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <Card title="Candidate evidence" ariaLabel="Candidate evidence">
            {parcelCandidates.length > 0 ? (
              <ol className="flex flex-col gap-3">
                {parcelCandidates.map((candidate, index) => (
                  <li
                    key={`${candidate.block}-${candidate.lot}-${index}`}
                    className="rounded-lg border border-border p-4"
                  >
                    <h3 className="font-medium text-ink">
                      Block {candidate.block} · Lot {candidate.lot}
                    </h3>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <EvidenceItem label="Address" value={candidate.streetAddress} />
                      <EvidenceItem label="Municipality" value={candidate.municipalityName} />
                      <EvidenceItem label="County" value={candidate.county} />
                      <EvidenceItem label="Property class" value={candidate.propertyClass} />
                      <EvidenceItem label="Qualifier" value={candidate.qualifier} />
                      <EvidenceItem label="Acreage" value={candidate.acreage} />
                      <EvidenceItem label="Year built" value={candidate.yearBuilt} />
                      <EvidenceItem label="Land value" value={formatMoney(candidate.landValue)} />
                      <EvidenceItem
                        label="Improvement value"
                        value={formatMoney(candidate.improvementValue)}
                      />
                      <EvidenceItem label="Net value" value={formatMoney(candidate.netValue)} />
                      <EvidenceItem label="Building" value={candidate.buildingDescription} />
                      <EvidenceItem label="Units" value={candidate.dwellingUnits} />
                    </dl>
                  </li>
                ))}
              </ol>
            ) : null}

            {duplicateIds.length > 0 ? (
              <ol className="flex flex-col gap-3">
                {duplicateIds.map((propertyId, index) => {
                  const property = duplicatesById.get(propertyId);
                  const address = duplicateAddressesByProperty.get(propertyId);
                  const parcel = duplicateParcelsByProperty.get(propertyId);
                  return (
                    <li key={propertyId} className="rounded-lg border border-border p-4">
                      <h3 className="font-medium text-ink">Candidate {index + 1}</h3>
                      <p className="mt-1 text-sm text-ink-muted">
                        {address?.canonical_address ??
                          property?.canonical_address ??
                          "Canonical address unavailable"}
                      </p>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                        <EvidenceItem
                          label="Municipality / County"
                          value={[property?.municipality, property?.county]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                        <EvidenceItem
                          label="Parcel"
                          value={parcel ? `Block ${parcel.block} · Lot ${parcel.lot}` : null}
                        />
                      </dl>
                    </li>
                  );
                })}
              </ol>
            ) : null}

            {addressResult ? (
              <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 sm:grid-cols-3">
                <EvidenceItem
                  label="Canonical address"
                  value={text(addressResult.canonicalAddress)}
                />
                <EvidenceItem
                  label="Match method"
                  value={
                    text(addressResult.matchMethod)
                      ? sentenceCase(text(addressResult.matchMethod)!)
                      : null
                  }
                />
                <EvidenceItem
                  label="Confidence"
                  value={
                    number(addressResult.confidence) === null
                      ? null
                      : `${number(addressResult.confidence)}%`
                  }
                />
                <EvidenceItem label="Municipality" value={text(addressResult.municipality)} />
                <EvidenceItem label="County" value={text(addressResult.county)} />
                <EvidenceItem label="ZIP" value={text(addressResult.zip)} />
              </dl>
            ) : null}

            {parcelCandidates.length === 0 && duplicateIds.length === 0 && !addressResult ? (
              <p className="rounded-lg border border-dashed border-border-strong p-5 text-sm text-ink-subtle">
                No structured candidate evidence was attached to this task.
              </p>
            ) : null}
          </Card>

          <Card title="Provider evidence" ariaLabel="Provider evidence">
            {providerRequests.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {providerRequests.map((request) => {
                  const retrievedAt = request.completed_at ?? request.requested_at;
                  return (
                    <li
                      key={request.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0"
                    >
                      <span className="font-medium text-ink">
                        {formatSource(request.provider)}
                      </span>
                      <span className="text-ink-subtle">
                        Retrieved{" "}
                        <time dateTime={retrievedAt}>{formatDateTime(retrievedAt)}</time>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-subtle">
                Provider retrieval dates are unavailable for this task.
              </p>
            )}
          </Card>

          <Card title="Map" ariaLabel="Map">
            <ParcelMap candidates={mapCandidates} />
            <p className="mt-2 text-xs text-ink-subtle">
              Parcel geometry is analytical and is not a legal survey.
            </p>
          </Card>
        </div>

        <aside aria-label="Review actions">
          <div className="flex flex-col gap-4 lg:sticky lg:top-6">
            <Card title="Resolve" ariaLabel="Resolve">
              <p className="text-sm text-ink-subtle">{resolveConsequence}</p>
              <form action={resolveReviewTask.bind(null, task.id)} className="mt-4 flex flex-col gap-4">
                {selectableCandidates.length > 0 ? (
                  <fieldset disabled={!isOpen} className="flex flex-col gap-2">
                    <legend className="text-sm font-medium text-ink-muted">
                      Selected candidate
                    </legend>
                    {selectableCandidates.map((candidate, index) => {
                      const label =
                        typeof candidate === "string"
                          ? duplicatesById.get(candidate)?.canonical_address ??
                            `Candidate ${index + 1}`
                          : `Block ${candidate.block} · Lot ${candidate.lot}`;
                      return (
                        <label
                          key={typeof candidate === "string" ? candidate : index}
                          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-ink"
                        >
                          <input type="radio" name="selectedCandidateIndex" value={index} />
                          {label}
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}
                <label className="block text-sm font-medium text-ink-muted">
                  Notes
                  <textarea name="notes" rows={3} disabled={!isOpen} className={textareaClasses} />
                </label>
                <ReviewSubmitButton disabled={!isOpen}>Resolve task</ReviewSubmitButton>
              </form>
            </Card>

            <Card title="Other actions" ariaLabel="Other actions">
              <div className="flex flex-col gap-4">
                <form action={retryReviewTask.bind(null, task.id)} className="flex flex-col gap-2">
                  <p className="text-sm text-ink-subtle">{retryConsequence}</p>
                  <label className="block text-sm font-medium text-ink-muted">
                    Retry notes
                    <textarea name="notes" rows={2} disabled={!isOpen} className={textareaClasses} />
                  </label>
                  <ReviewSubmitButton disabled={!isOpen} tone="neutral">
                    Retry worker
                  </ReviewSubmitButton>
                </form>

                <form
                  action={markReviewTaskUnsupported.bind(null, task.id)}
                  className="flex flex-col gap-2 border-t border-border pt-4"
                >
                  <p className="text-sm text-ink-subtle">
                    Marks the property unsupported and completes the pipeline with partial
                    results.
                  </p>
                  <label className="block text-sm font-medium text-ink-muted">
                    Unsupported notes
                    <textarea name="notes" rows={2} disabled={!isOpen} className={textareaClasses} />
                  </label>
                  <ReviewSubmitButton disabled={!isOpen} tone="neutral">
                    Mark unsupported
                  </ReviewSubmitButton>
                </form>

                <form
                  action={rejectReviewTask.bind(null, task.id)}
                  className="flex flex-col gap-2 border-t border-border pt-4"
                >
                  <p className="text-sm text-ink-subtle">
                    Closes this task and marks the pipeline failed without selecting a
                    candidate.
                  </p>
                  <label className="block text-sm font-medium text-ink-muted">
                    Rejection notes
                    <textarea name="notes" rows={2} disabled={!isOpen} className={textareaClasses} />
                  </label>
                  <ReviewSubmitButton disabled={!isOpen} tone="danger">
                    Reject task
                  </ReviewSubmitButton>
                </form>
              </div>
            </Card>
          </div>
        </aside>
      </div>
    </main>
  );
}
