import "server-only";
import { addressValidationResultSchema } from "@/domain/property-identity";
import { isExactNjEvidence } from "@/modules/roof-assessment/post-consent-property-prefetch";
import type { TurnstileResult } from "./turnstile";

export type CreatePreviewInput = {
  companyId: string;
  address: string;
  googlePlaceId: string | null;
  campaign: string | null;
  entryPoint: string;
  presentationKey: string;
  attribution: Record<string, string | null>;
  referrer: string | null;
  clientIp: string;
  userAgent: string;
  turnstileToken: string;
  privacyConsentToken?: string | null;
};

export type CreatePreviewResult =
  | {kind: "created"; previewUrl: string}
  | {kind: "challenge_failed"}
  | {kind: "rate_limited"}
  | {kind: "disabled"};

export type PreviewMeasurementStatus = "pending" | "ready" | "no_coverage" | "skipped" | "unavailable";

export interface PropertyPreviewRepository {
  create(input: {
    companyId: string;
    tokenHash: string;
    submittedAddress: string;
    googlePlaceId: string | null;
    addressMode: "google" | "manual";
    campaign: string | null;
    entryPoint: string;
    presentationKey: string;
    attribution: Record<string, string | null>;
    referrer: string | null;
    processingDisclosureVersion: string;
    processingAcceptedAt: string;
    ipAddress: string;
    userAgent: string;
    privacyConsentToken: string | null;
  }): Promise<{previewId: string; rateLimited: boolean}>;
  applyPlace(input: {
    companyId: string;
    previewId: string;
    canonicalAddress: string;
    latitude: number;
    longitude: number;
  }): Promise<void>;
  setMeasurementStatus(input: {
    companyId: string;
    previewId: string;
    status: PreviewMeasurementStatus;
  }): Promise<void>;
}

export type CreatePreviewDependencies = {
  enabled: boolean;
  disclosureVersion: string;
  verifyTurnstile(input: {token: string; remoteIp: string}): Promise<TurnstileResult>;
  issueToken(): {token: string; tokenHash: string};
  resolveHost(companyId: string): Promise<string | null>;
  repository: PropertyPreviewRepository;
  fetchPlaceDetails(input: {
    submittedAddress: string;
    googlePlaceId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  requestMeasurement(input: {companyId: string; previewId: string}): Promise<void>;
  now?: () => Date;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
};

const PLACE_DETAILS_BUDGET_MS = 2_500;

/**
 * Creates an anonymous preview for an address. Order matters: the challenge is
 * verified before anything is written, and the preview (with its committed
 * property-processing evidence) exists before any Google call. Provider
 * failures degrade the reveal; they never fail the preview.
 */
export async function createPropertyPreview(
  input: CreatePreviewInput,
  dependencies: CreatePreviewDependencies,
): Promise<CreatePreviewResult> {
  if (!dependencies.enabled) return {kind: "disabled"};

  const challenge = await dependencies.verifyTurnstile({token: input.turnstileToken, remoteIp: input.clientIp});
  if (challenge.kind !== "passed") return {kind: "challenge_failed"};

  const host = await dependencies.resolveHost(input.companyId);
  if (!host) return {kind: "disabled"};

  const now = dependencies.now ?? (() => new Date());
  const {token, tokenHash} = dependencies.issueToken();
  const googlePlaceId = input.googlePlaceId?.trim() || null;
  const created = await dependencies.repository.create({
    companyId: input.companyId,
    tokenHash,
    submittedAddress: input.address,
    googlePlaceId,
    addressMode: googlePlaceId ? "google" : "manual",
    campaign: input.campaign,
    entryPoint: input.entryPoint,
    presentationKey: input.presentationKey,
    attribution: input.attribution,
    referrer: input.referrer,
    processingDisclosureVersion: dependencies.disclosureVersion,
    processingAcceptedAt: now().toISOString(),
    ipAddress: input.clientIp,
    userAgent: input.userAgent,
    privacyConsentToken: input.privacyConsentToken ?? null,
  });
  if (created.rateLimited) return {kind: "rate_limited"};

  const previewUrl = `https://${host}/roof-estimate/p/${token}`;
  const scope = {companyId: input.companyId, previewId: created.previewId};
  const unavailable = () => dependencies.repository.setMeasurementStatus({...scope, status: "unavailable"}).catch(() => undefined);

  if (!googlePlaceId) {
    await unavailable();
    return {kind: "created", previewUrl};
  }

  let evidence: unknown;
  try {
    const createTimeoutSignal = dependencies.createTimeoutSignal ?? AbortSignal.timeout;
    evidence = await dependencies.fetchPlaceDetails({
      submittedAddress: input.address,
      googlePlaceId,
      signal: createTimeoutSignal(PLACE_DETAILS_BUDGET_MS),
    });
  } catch {
    await unavailable();
    return {kind: "created", previewUrl};
  }

  const parsed = addressValidationResultSchema.safeParse(evidence);
  if (!parsed.success || !isExactNjEvidence(parsed.data, googlePlaceId)) {
    await unavailable();
    return {kind: "created", previewUrl};
  }

  try {
    await dependencies.repository.applyPlace({
      ...scope,
      canonicalAddress: parsed.data.canonicalAddress!,
      latitude: parsed.data.latitude!,
      longitude: parsed.data.longitude!,
    });
    await dependencies.requestMeasurement(scope);
  } catch {
    await unavailable();
  }
  return {kind: "created", previewUrl};
}
