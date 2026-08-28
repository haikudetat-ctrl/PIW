import { z } from "zod";
import { campaignSlugs, type CampaignSlug } from "@/config/campaigns";
import {
  roofAssessmentEntryContexts,
  roofAssessmentEntryPoints,
  roofAssessmentPresentationKeys,
  type AssessmentEntryPoint,
  type RoofAssessmentPresentationKey,
} from "@/config/roof-assessment";
import type { CampaignAttribution } from "@/modules/leads/accept-all-season-campaign-estimate";
import {
  normalizeEmailForMatching,
  normalizePhoneToE164,
} from "@/modules/leads/normalize-contact";
import type {
  PostConsentPropertyPrefetchInput,
  PostConsentPropertyPrefetchResult,
} from "./post-consent-property-prefetch";

export type { AssessmentEntryPoint, RoofAssessmentPresentationKey };

export type StartAssessmentInput = {
  submissionId: string;
  companyId: string;
  name: string;
  email: string;
  phone: string;
  submittedAddress: string;
  googlePlaceId?: string;
  campaign: CampaignSlug | null;
  presentationKey: RoofAssessmentPresentationKey;
  entryPoint: AssessmentEntryPoint;
  attribution: CampaignAttribution;
  referrer: string | null;
  consent: {
    disclosureVersion: string;
    ipAddress: string;
    userAgent: string;
    grantedAt: string;
  };
};

export type NormalizedAssessmentIntake = Omit<
  StartAssessmentInput,
  "email" | "phone"
> & {
  emailNormalized: string;
  phoneE164: string;
};

export type StartAssessmentResult =
  | {
      kind: "continue";
      continuationPath: `/roof-estimate/continue/${string}`;
    }
  | {kind: "duplicate_requires_restart"};

export interface AssessmentIntakeRepository {
  startOrResume(input: NormalizedAssessmentIntake): Promise<unknown>;
}

export interface ContinuationTokenIssuer {
  issue(input: {
    attemptId: string;
    secret: string;
    expiresAt: string;
  }): Promise<string>;
}

export type StartAssessmentDependencies = {
  repository: AssessmentIntakeRepository;
  tokenIssuer: ContinuationTokenIssuer;
  postConsentPrefetch?: (input: PostConsentPropertyPrefetchInput) =>
    Promise<PostConsentPropertyPrefetchResult>;
};

export class StartAssessmentInputError extends Error {
  constructor() {
    super("Invalid roof assessment intake");
    this.name = "StartAssessmentInputError";
  }
}

export class StartAssessmentInternalError extends Error {
  constructor() {
    super("Unable to start roof assessment");
    this.name = "StartAssessmentInternalError";
  }
}

const nullableAttributionValueSchema = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((value) => value || null);

const attributionSchema = z.object({
  utm_source: nullableAttributionValueSchema,
  utm_medium: nullableAttributionValueSchema,
  utm_campaign: nullableAttributionValueSchema,
  utm_term: nullableAttributionValueSchema,
  utm_content: nullableAttributionValueSchema,
  fbclid: nullableAttributionValueSchema,
  fbp: nullableAttributionValueSchema,
  fbc: nullableAttributionValueSchema,
}).strict();

const campaignSchema = z.enum(campaignSlugs);
const presentationKeySchema = z.enum(roofAssessmentPresentationKeys);
const entryPointSchema = z.enum(
  roofAssessmentEntryPoints as [AssessmentEntryPoint, ...AssessmentEntryPoint[]],
);

const startAssessmentInputSchema = z.object({
  submissionId: z.uuid(),
  companyId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().pipe(z.email().max(320)),
  phone: z.string().trim().min(1).max(40),
  submittedAddress: z.string().trim().min(5).max(500),
  googlePlaceId: z.string().trim().min(1).max(300).optional(),
  campaign: campaignSchema.nullable(),
  presentationKey: presentationKeySchema,
  entryPoint: entryPointSchema,
  attribution: attributionSchema,
  referrer: z.string().trim().max(2_000).nullable(),
  consent: z.object({
    disclosureVersion: z.string().trim().min(1).max(200),
    ipAddress: z.union([z.ipv4(), z.ipv6()]),
    userAgent: z.string().trim().min(1).max(1_000),
    grantedAt: z.iso.datetime({offset: true}),
  }).strict(),
}).strict().superRefine((value, context) => {
  const expected = roofAssessmentEntryContexts[value.entryPoint];
  if (
    value.campaign !== expected.campaign
    || value.presentationKey !== expected.presentationKey
  ) {
    context.addIssue({
      code: "custom",
      path: ["campaign"],
      message: "Assessment context does not match its entry point",
    });
  }
});

const firstAttemptSchema = z.object({
  attemptId: z.uuid(),
  continuationSecret: z.string().min(1),
  expiresAt: z.iso.datetime({offset: true}),
  isReplay: z.literal(false),
}).strict();

const replayAttemptSchema = z.object({
  attemptId: z.uuid(),
  continuationSecret: z.null(),
  expiresAt: z.iso.datetime({offset: true}),
  isReplay: z.literal(true),
}).strict();

const repositoryResultSchema = z.discriminatedUnion("isReplay", [
  firstAttemptSchema,
  replayAttemptSchema,
]);

const continuationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ");
}

function normalizeInput(input: StartAssessmentInput): NormalizedAssessmentIntake {
  const parsed = startAssessmentInputSchema.safeParse(input);
  if (!parsed.success) throw new StartAssessmentInputError();

  const phoneE164 = normalizePhoneToE164(parsed.data.phone);
  if (!phoneE164) throw new StartAssessmentInputError();

  return {
    submissionId: parsed.data.submissionId,
    companyId: parsed.data.companyId,
    name: collapseWhitespace(parsed.data.name),
    emailNormalized: normalizeEmailForMatching(parsed.data.email),
    phoneE164,
    submittedAddress: collapseWhitespace(parsed.data.submittedAddress),
    googlePlaceId: parsed.data.googlePlaceId,
    campaign: parsed.data.campaign,
    presentationKey: parsed.data.presentationKey,
    entryPoint: parsed.data.entryPoint,
    attribution: parsed.data.attribution,
    referrer: parsed.data.referrer || null,
    consent: parsed.data.consent,
  };
}

export async function startOrResumeRoofAssessment(
  input: StartAssessmentInput,
  dependencies: StartAssessmentDependencies,
): Promise<StartAssessmentResult> {
  const normalized = normalizeInput(input);
  const repositoryResult = repositoryResultSchema.safeParse(
    await dependencies.repository.startOrResume(normalized),
  );
  if (!repositoryResult.success) throw new StartAssessmentInternalError();

  if (repositoryResult.data.isReplay) {
    return {kind: "duplicate_requires_restart"};
  }

  if (dependencies.postConsentPrefetch && normalized.googlePlaceId) {
    try {
      await dependencies.postConsentPrefetch({
        companyId: normalized.companyId,
        attemptId: repositoryResult.data.attemptId,
        submittedAddress: normalized.submittedAddress,
        googlePlaceId: normalized.googlePlaceId,
      });
    } catch {
      // Property intelligence is a best-effort post-consent fast path.
    }
  }

  let issuedToken: string;
  try {
    issuedToken = await dependencies.tokenIssuer.issue({
      attemptId: repositoryResult.data.attemptId,
      secret: repositoryResult.data.continuationSecret,
      expiresAt: repositoryResult.data.expiresAt,
    });
  } catch {
    throw new StartAssessmentInternalError();
  }

  const token = continuationTokenSchema.safeParse(issuedToken);
  if (!token.success) throw new StartAssessmentInternalError();

  return {
    kind: "continue",
    continuationPath: `/roof-estimate/continue/${token.data}`,
  };
}
