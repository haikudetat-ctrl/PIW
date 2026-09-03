import "server-only";
import {z} from "zod";
import {createServiceClient} from "@/lib/supabase/service";
import {
  normalizeConsentPreferences,
  type ConsentPreferences,
  type VerifiedConsent,
} from "./consent";

export type PrivacyConsentEvidenceInput = {
  evidenceId: string;
  consentId: string;
  policyVersion: "piw-privacy-v1";
  preferences: ConsentPreferences;
  gpcDetected: boolean;
  source: "banner" | "preferences" | "gpc";
  requestIp: string | null;
  userAgent: string;
  occurredAt: string;
};

export interface PrivacyConsentRepository {
  /** Returns the canonical evidence selected by the atomic database write. */
  record(input: PrivacyConsentEvidenceInput): Promise<VerifiedConsent | void>;
}

/** Server-only read boundary for the unlinked, cross-origin current preference. */
export interface CurrentPrivacyConsentRepository extends PrivacyConsentRepository {
  readCurrent(input: {
    consentId: string;
    policyVersion: "piw-privacy-v1";
  }): Promise<VerifiedConsent | null>;
}

type PrivacyConsentRpcClient = {
  rpc(
    functionName: "record_public_privacy_consent",
    arguments_: {
      p_evidence_id: string;
      p_consent_id: string;
      p_policy_version: "piw-privacy-v1";
      p_analytics_granted: boolean;
      p_advertising_granted: boolean;
      p_gpc_detected: boolean;
      p_source: "banner" | "preferences" | "gpc";
      p_request_ip: string | null;
      p_user_agent: string;
      p_occurred_at: string;
    },
  ): Promise<{data: unknown; error: {message: string} | null}>;
};

type CurrentPrivacyConsentQuery = {
  select(columns: string): CurrentPrivacyConsentQuery;
  eq(column: string, value: string): CurrentPrivacyConsentQuery;
  is(column: "company_id" | "lead_id", value: null): CurrentPrivacyConsentQuery;
  order(
    column: "occurred_at" | "advertising_granted" | "gpc_detected" | "created_at" | "evidence_id",
    options: {ascending: boolean},
  ): CurrentPrivacyConsentQuery;
  limit(value: number): CurrentPrivacyConsentQuery;
  maybeSingle(): Promise<{data: unknown; error: {message: string} | null}>;
};

type PrivacyConsentService = PrivacyConsentRpcClient & {
  from(table: "privacy_consent_evidence"): CurrentPrivacyConsentQuery;
};

const currentConsentEvidenceSchema = z.object({
  consent_id: z.uuid(),
  policy_version: z.literal("piw-privacy-v1"),
  analytics_granted: z.boolean(),
  advertising_granted: z.boolean(),
  gpc_detected: z.boolean(),
  occurred_at: z.iso.datetime({offset: true}),
}).strict();
const publicConsentWriteSchema = z.array(currentConsentEvidenceSchema.extend({
  evidence_id: z.uuid(),
})).length(1);

/** Durable public-consent limits are enforced atomically by Postgres. */
export class PrivacyConsentRateLimitError extends Error {
  constructor() {
    super("Privacy consent request limit exceeded");
    this.name = "PrivacyConsentRateLimitError";
  }
}

/** Persists public consent evidence without accepting tenant or lead scope from browsers. */
export class SupabasePrivacyConsentRepository implements CurrentPrivacyConsentRepository {
  constructor(
    private readonly service: PrivacyConsentService = createServiceClient() as unknown as PrivacyConsentService,
  ) {}

  async record(input: PrivacyConsentEvidenceInput) {
    const {data, error} = await this.service.rpc("record_public_privacy_consent", {
      p_evidence_id: input.evidenceId,
      p_consent_id: input.consentId,
      p_policy_version: input.policyVersion,
      p_analytics_granted: input.preferences.analytics,
      p_advertising_granted: input.preferences.advertising,
      p_gpc_detected: input.gpcDetected,
      p_source: input.source,
      p_request_ip: input.requestIp,
      p_user_agent: input.userAgent,
      p_occurred_at: input.occurredAt,
    });
    if (error?.message === "Privacy consent request limit exceeded") {
      throw new PrivacyConsentRateLimitError();
    }
    if (error) throw new Error("Failed to record privacy consent evidence");
    const parsed = publicConsentWriteSchema.safeParse(data);
    if (!parsed.success) throw new Error("Failed to record privacy consent evidence");
    const evidence = parsed.data[0];
    return {
      policyVersion: evidence.policy_version,
      consentId: evidence.consent_id,
      preferences: normalizeConsentPreferences({
        analytics: evidence.analytics_granted,
        advertising: evidence.advertising_granted,
      }, evidence.gpc_detected),
      gpcDetected: evidence.gpc_detected,
      updatedAt: evidence.occurred_at,
    } satisfies VerifiedConsent;
  }

  async readCurrent(input: {
    consentId: string;
    policyVersion: "piw-privacy-v1";
  }): Promise<VerifiedConsent | null> {
    const {data, error} = await this.service
      .from("privacy_consent_evidence")
      .select("consent_id, policy_version, analytics_granted, advertising_granted, gpc_detected, occurred_at")
      .eq("consent_id", input.consentId)
      .eq("policy_version", input.policyVersion)
      .is("company_id", null)
      .is("lead_id", null)
      .order("occurred_at", {ascending: false})
      .order("advertising_granted", {ascending: true})
      .order("gpc_detected", {ascending: false})
      .order("created_at", {ascending: false})
      .order("evidence_id", {ascending: false})
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Failed to read current privacy consent");
    if (!data) return null;
    const evidence = currentConsentEvidenceSchema.safeParse(data);
    if (!evidence.success) throw new Error("Failed to read current privacy consent");
    return {
      policyVersion: evidence.data.policy_version,
      consentId: evidence.data.consent_id,
      preferences: normalizeConsentPreferences({
        analytics: evidence.data.analytics_granted,
        advertising: evidence.data.advertising_granted,
      }, evidence.data.gpc_detected),
      gpcDetected: evidence.data.gpc_detected,
      updatedAt: evidence.data.occurred_at,
    };
  }
}
