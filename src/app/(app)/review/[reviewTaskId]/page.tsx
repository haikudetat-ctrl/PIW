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

function formatReason(reason: string): string {
  return reason
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function formatMoney(value: unknown): string | null {
  const amount = number(value);
  return amount === null
    ? null
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount);
}

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
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
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
  const { data: duplicateProperties } =
    duplicateIds.length > 0
      ? await supabase
          .from("properties")
          .select("id, canonical_address, municipality, county")
          .in("id", duplicateIds)
      : { data: [] };
  const duplicatesById = new Map(
    (duplicateProperties ?? []).map((property) => [property.id, property]),
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
  const isOpen = task.status === "open";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Link
        href="/review"
        className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
      >
        ← Review queue
      </Link>

      <header className="mt-5 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
              {formatReason(task.reason)}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Review property match
            </h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              {task.leads?.name ?? "Unknown lead"} ·{" "}
              {task.leads?.submitted_address ?? "No submitted address"}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isOpen
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            {task.status}
          </span>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section aria-labelledby="candidate-evidence-heading">
            <h2
              id="candidate-evidence-heading"
              className="text-lg font-semibold"
            >
              Candidate evidence
            </h2>

            {parcelCandidates.length > 0 ? (
              <ol className="mt-3 space-y-3">
                {parcelCandidates.map((candidate, index) => (
                  <li
                    key={`${candidate.block}-${candidate.lot}-${index}`}
                    className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
                  >
                    <h3 className="font-medium">
                      Block {candidate.block} · Lot {candidate.lot}
                    </h3>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <EvidenceItem
                        label="Address"
                        value={candidate.streetAddress}
                      />
                      <EvidenceItem
                        label="Municipality"
                        value={candidate.municipalityName}
                      />
                      <EvidenceItem label="County" value={candidate.county} />
                      <EvidenceItem
                        label="Property class"
                        value={candidate.propertyClass}
                      />
                      <EvidenceItem
                        label="Qualifier"
                        value={candidate.qualifier}
                      />
                      <EvidenceItem
                        label="Acreage"
                        value={candidate.acreage}
                      />
                      <EvidenceItem
                        label="Year built"
                        value={candidate.yearBuilt}
                      />
                      <EvidenceItem
                        label="Land value"
                        value={formatMoney(candidate.landValue)}
                      />
                      <EvidenceItem
                        label="Improvement value"
                        value={formatMoney(candidate.improvementValue)}
                      />
                      <EvidenceItem
                        label="Net value"
                        value={formatMoney(candidate.netValue)}
                      />
                      <EvidenceItem
                        label="Building"
                        value={candidate.buildingDescription}
                      />
                      <EvidenceItem
                        label="Units"
                        value={candidate.dwellingUnits}
                      />
                    </dl>
                  </li>
                ))}
              </ol>
            ) : null}

            {duplicateIds.length > 0 ? (
              <ol className="mt-3 space-y-3">
                {duplicateIds.map((propertyId, index) => {
                  const property = duplicatesById.get(propertyId);
                  return (
                    <li
                      key={propertyId}
                      className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
                    >
                      <h3 className="font-medium">Candidate {index + 1}</h3>
                      <p className="mt-1 text-sm">
                        {property?.canonical_address ??
                          "Canonical address unavailable"}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {[property?.municipality, property?.county]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  );
                })}
              </ol>
            ) : null}

            {addressResult ? (
              <dl className="mt-3 grid grid-cols-2 gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800 sm:grid-cols-3">
                <EvidenceItem
                  label="Canonical address"
                  value={text(addressResult.canonicalAddress)}
                />
                <EvidenceItem
                  label="Match method"
                  value={text(addressResult.matchMethod)?.replaceAll("_", " ")}
                />
                <EvidenceItem
                  label="Confidence"
                  value={
                    number(addressResult.confidence) === null
                      ? null
                      : `${number(addressResult.confidence)}%`
                  }
                />
                <EvidenceItem
                  label="Municipality"
                  value={text(addressResult.municipality)}
                />
                <EvidenceItem
                  label="County"
                  value={text(addressResult.county)}
                />
                <EvidenceItem label="ZIP" value={text(addressResult.zip)} />
              </dl>
            ) : null}

            {parcelCandidates.length === 0 &&
            duplicateIds.length === 0 &&
            !addressResult ? (
              <p className="mt-3 rounded-lg border border-dashed border-neutral-300 p-5 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                No structured candidate evidence was attached to this task.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="parcel-map-heading">
            <h2 id="parcel-map-heading" className="text-lg font-semibold">
              Map
            </h2>
            <div className="mt-3">
              <ParcelMap candidates={mapCandidates} />
            </div>
            <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
              Parcel geometry is analytical and is not a legal survey.
            </p>
          </section>
        </div>

        <aside aria-label="Review actions">
          <div className="space-y-4 lg:sticky lg:top-6">
            <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <h2 className="font-semibold">Resolve</h2>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Accept the placeholder or select the correct candidate.
              </p>
              <form
                action={resolveReviewTask.bind(null, task.id)}
                className="mt-4 space-y-4"
              >
                {selectableCandidates.length > 0 ? (
                  <fieldset disabled={!isOpen} className="space-y-2">
                    <legend className="text-sm font-medium">
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
                          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700"
                        >
                          <input
                            type="radio"
                            name="selectedCandidateIndex"
                            value={index}
                          />
                          {label}
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}
                <label className="block text-sm font-medium">
                  Notes
                  <textarea
                    name="notes"
                    rows={3}
                    disabled={!isOpen}
                    className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60 dark:border-neutral-700"
                  />
                </label>
                <ReviewSubmitButton disabled={!isOpen}>
                  Resolve task
                </ReviewSubmitButton>
              </form>
            </section>

            <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <h2 className="font-semibold">Other actions</h2>
              <div className="mt-4 space-y-4">
                <form
                  action={retryReviewTask.bind(null, task.id)}
                  className="space-y-2"
                >
                  <label className="block text-sm font-medium">
                    Retry notes
                    <textarea
                      name="notes"
                      rows={2}
                      disabled={!isOpen}
                      className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60 dark:border-neutral-700"
                    />
                  </label>
                  <ReviewSubmitButton disabled={!isOpen} tone="neutral">
                    Retry worker
                  </ReviewSubmitButton>
                </form>

                <form
                  action={markReviewTaskUnsupported.bind(null, task.id)}
                  className="space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800"
                >
                  <label className="block text-sm font-medium">
                    Unsupported notes
                    <textarea
                      name="notes"
                      rows={2}
                      disabled={!isOpen}
                      className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60 dark:border-neutral-700"
                    />
                  </label>
                  <ReviewSubmitButton disabled={!isOpen} tone="neutral">
                    Mark unsupported
                  </ReviewSubmitButton>
                </form>

                <form
                  action={rejectReviewTask.bind(null, task.id)}
                  className="space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800"
                >
                  <label className="block text-sm font-medium">
                    Rejection notes
                    <textarea
                      name="notes"
                      rows={2}
                      disabled={!isOpen}
                      className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-60 dark:border-neutral-700"
                    />
                  </label>
                  <ReviewSubmitButton disabled={!isOpen} tone="danger">
                    Reject task
                  </ReviewSubmitButton>
                </form>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}
