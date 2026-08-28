import "server-only";
import {
  addressValidationResultSchema,
  type AddressValidationResult,
} from "@/domain/property-identity";

export type PostConsentPropertyPrefetchInput = {
  companyId: string;
  attemptId: string;
  submittedAddress: string;
  googlePlaceId: string;
};

export type PostConsentPropertyPrefetchResult =
  | {kind: "applied" | "already_applied"; providerDurationMs: number; totalDurationMs: number}
  | {kind: "skipped"; reason: "disabled" | "not_exact" | "not_new"}
  | {kind: "deferred"; reason: "timeout" | "provider_failed" | "persistence_failed"};

export interface PropertyPrefetchRepository {
  resolveScope(input: {
    companyId: string;
    attemptId: string;
    googlePlaceId: string;
  }): Promise<{eligible: boolean}>;
  apply(input: {
    companyId: string;
    attemptId: string;
    evidence: AddressValidationResult;
    provider: "google_places";
    sourceIdentifier: string;
    retrievedAt: string;
    providerDurationMs: number;
  }): Promise<{sideEffectsApplied: boolean}>;
}

type CompletionLog = {
  outcome: PostConsentPropertyPrefetchResult["kind"];
  reason: "disabled" | "not_exact" | "not_new" | "timeout" | "provider_failed" | "persistence_failed" | undefined;
  providerDurationMs: number;
  persistenceDurationMs: number;
  totalDurationMs: number;
};

export type PostConsentPropertyPrefetchDependencies = {
  enabled: boolean;
  repository: PropertyPrefetchRepository;
  fetchGooglePlaceDetails(input: {
    submittedAddress: string;
    googlePlaceId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  clock?: () => number;
  now?: () => Date;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
  logCompletion?: (context: CompletionLog) => void;
};

function isExactNjEvidence(
  evidence: AddressValidationResult,
  googlePlaceId: string,
): boolean {
  return evidence.googlePlaceId === googlePlaceId &&
    evidence.matchMethod === "exact_single_match" &&
    evidence.stateCode === "NJ" &&
    evidence.confidence >= 95 &&
    evidence.latitude !== null &&
    Number.isFinite(evidence.latitude) &&
    evidence.longitude !== null &&
    Number.isFinite(evidence.longitude);
}

export async function runPostConsentPropertyPrefetch(
  input: PostConsentPropertyPrefetchInput,
  dependencies: PostConsentPropertyPrefetchDependencies,
): Promise<PostConsentPropertyPrefetchResult> {
  const clock = dependencies.clock ?? Date.now;
  const now = dependencies.now ?? (() => new Date());
  const createTimeoutSignal = dependencies.createTimeoutSignal ?? AbortSignal.timeout;
  const startedAt = clock();
  let providerDurationMs = 0;
  let persistenceDurationMs = 0;

  const complete = (result: PostConsentPropertyPrefetchResult) => {
    const totalDurationMs = Math.max(0, clock() - startedAt);
    const log: CompletionLog = {
      outcome: result.kind,
      reason: "reason" in result ? result.reason : undefined,
      providerDurationMs,
      persistenceDurationMs,
      totalDurationMs,
    };
    try {
      dependencies.logCompletion?.(log);
    } catch {
      // Completion telemetry must never affect this best-effort fast path.
    }
    return result;
  };

  if (!dependencies.enabled) {
    return complete({kind: "skipped", reason: "disabled"});
  }

  const googlePlaceId = input.googlePlaceId.trim();
  if (!googlePlaceId) {
    return complete({kind: "skipped", reason: "not_new"});
  }

  let eligible: boolean;
  try {
    ({eligible} = await dependencies.repository.resolveScope({
      companyId: input.companyId,
      attemptId: input.attemptId,
      googlePlaceId,
    }));
  } catch {
    return complete({kind: "deferred", reason: "persistence_failed"});
  }
  if (!eligible) {
    return complete({kind: "skipped", reason: "not_new"});
  }

  const signal = createTimeoutSignal(2_500);
  let rawEvidence: unknown;
  const providerStartedAt = clock();
  try {
    rawEvidence = await dependencies.fetchGooglePlaceDetails({
      submittedAddress: input.submittedAddress,
      googlePlaceId,
      signal,
    });
  } catch {
    providerDurationMs = Math.max(0, clock() - providerStartedAt);
    return complete({
      kind: "deferred",
      reason: signal.aborted ? "timeout" : "provider_failed",
    });
  }
  providerDurationMs = Math.max(0, clock() - providerStartedAt);

  const parsedEvidence = addressValidationResultSchema.safeParse(rawEvidence);
  if (!parsedEvidence.success || !isExactNjEvidence(parsedEvidence.data, googlePlaceId)) {
    return complete({kind: "skipped", reason: "not_exact"});
  }

  const persistenceStartedAt = clock();
  try {
    const applied = await dependencies.repository.apply({
      companyId: input.companyId,
      attemptId: input.attemptId,
      evidence: parsedEvidence.data,
      provider: "google_places",
      sourceIdentifier: googlePlaceId,
      retrievedAt: now().toISOString(),
      providerDurationMs,
    });
    persistenceDurationMs = Math.max(0, clock() - persistenceStartedAt);
    return complete({
      kind: applied.sideEffectsApplied ? "applied" : "already_applied",
      providerDurationMs,
      totalDurationMs: Math.max(0, clock() - startedAt),
    });
  } catch {
    persistenceDurationMs = Math.max(0, clock() - persistenceStartedAt);
    return complete({kind: "deferred", reason: "persistence_failed"});
  }
}
