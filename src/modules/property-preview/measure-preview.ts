import { normalizeAddressForMatching } from "@/modules/property-identity/normalize-address";

// Roof measurement for an anonymous preview. It reuses the company's cached
// Google Solar insight for the canonical address when one exists, so the lead
// worker finds the same row after conversion. A provider failure or an empty
// budget degrades the reveal and never throws.

type InsightStatus = "success" | "no_coverage";
type MeasuredInsight = {status: InsightStatus};

export type MeasurePreviewDependencies = {
  loadPreview(scope: {companyId: string; previewId: string}): Promise<{
    propertyId: string;
    measurementStatus: "pending" | "ready" | "no_coverage" | "skipped" | "unavailable";
    canonicalAddress: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null>;
  findCachedInsight(input: {companyId: string; normalizedAddress: string}): Promise<{id: string; insight: MeasuredInsight} | null>;
  reserveSolarCall(): Promise<{allowed: boolean}>;
  beginProviderRequest(input: {companyId: string; previewId: string}): Promise<{providerRequestId: string}>;
  measureRoof(input: {companyId: string; previewId: string; latitude: number; longitude: number}): Promise<{
    insight: MeasuredInsight;
    retrievedAt: string;
    sourceIdentifier: string;
  }>;
  persistInsight(input: {
    companyId: string;
    propertyId: string;
    normalizedAddress: string;
    latitude: number;
    longitude: number;
    insight: MeasuredInsight;
    retrievedAt: string;
  }): Promise<{id: string}>;
  completeProviderRequest(input: {
    companyId: string;
    providerRequestId: string;
    insight: MeasuredInsight;
    retrievedAt: string;
    sourceIdentifier: string;
  }): Promise<void>;
  failProviderRequest(input: {companyId: string; providerRequestId: string}): Promise<void>;
  complete(input: {companyId: string; previewId: string; roofInsightId: string; status: "ready" | "no_coverage"}): Promise<void>;
  setStatus(input: {companyId: string; previewId: string; status: "skipped" | "unavailable"}): Promise<void>;
};

export type MeasurePreviewResult =
  | {kind: "measured" | "cache_hit" | "budget_exhausted" | "unavailable" | "skipped"};

const toPreviewStatus = (insight: MeasuredInsight) => insight.status === "success" ? "ready" as const : "no_coverage" as const;

export async function measurePropertyPreview(
  scope: {companyId: string; previewId: string},
  dependencies: MeasurePreviewDependencies,
): Promise<MeasurePreviewResult> {
  const preview = await dependencies.loadPreview(scope);
  if (!preview || preview.measurementStatus !== "pending") return {kind: "skipped"};
  if (preview.canonicalAddress === null || preview.latitude === null || preview.longitude === null) {
    await dependencies.setStatus({...scope, status: "unavailable"});
    return {kind: "unavailable"};
  }

  const normalizedAddress = normalizeAddressForMatching(preview.canonicalAddress);
  const cached = await dependencies.findCachedInsight({companyId: scope.companyId, normalizedAddress});
  if (cached) {
    await dependencies.complete({...scope, roofInsightId: cached.id, status: toPreviewStatus(cached.insight)});
    return {kind: "cache_hit"};
  }

  const budget = await dependencies.reserveSolarCall();
  if (!budget.allowed) {
    await dependencies.setStatus({...scope, status: "skipped"});
    return {kind: "budget_exhausted"};
  }

  const {providerRequestId} = await dependencies.beginProviderRequest(scope);
  let measured: Awaited<ReturnType<MeasurePreviewDependencies["measureRoof"]>>;
  try {
    measured = await dependencies.measureRoof({...scope, latitude: preview.latitude, longitude: preview.longitude});
  } catch {
    await dependencies.failProviderRequest({companyId: scope.companyId, providerRequestId});
    await dependencies.setStatus({...scope, status: "unavailable"});
    return {kind: "unavailable"};
  }

  const insight = await dependencies.persistInsight({
    companyId: scope.companyId,
    propertyId: preview.propertyId,
    normalizedAddress,
    latitude: preview.latitude,
    longitude: preview.longitude,
    insight: measured.insight,
    retrievedAt: measured.retrievedAt,
  });
  await dependencies.completeProviderRequest({
    companyId: scope.companyId,
    providerRequestId,
    insight: measured.insight,
    retrievedAt: measured.retrievedAt,
    sourceIdentifier: measured.sourceIdentifier,
  });
  await dependencies.complete({...scope, roofInsightId: insight.id, status: toPreviewStatus(measured.insight)});
  return {kind: "measured"};
}
