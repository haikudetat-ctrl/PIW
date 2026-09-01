import "server-only";
import {createServiceClient} from "@/lib/supabase/service";
import type {ConsentPreferences} from "./consent";

export type PrivacyConsentEvidenceInput = {
  evidenceId: string;
  consentId: string;
  policyVersion: "piw-privacy-v1";
  preferences: ConsentPreferences;
  gpcDetected: boolean;
  source: "banner" | "preferences" | "gpc";
  requestIp: string;
  userAgent: string;
  occurredAt: string;
};

export interface PrivacyConsentRepository {
  record(input: PrivacyConsentEvidenceInput): Promise<void>;
}

type PrivacyConsentRpcClient = {
  rpc(
    functionName: "record_privacy_consent",
    arguments_: {
      p_evidence_id: string;
      p_consent_id: string;
      p_company_id: null;
      p_lead_id: null;
      p_policy_version: "piw-privacy-v1";
      p_analytics_granted: boolean;
      p_advertising_granted: boolean;
      p_gpc_detected: boolean;
      p_source: "banner" | "preferences" | "gpc";
      p_request_ip: string;
      p_user_agent: string;
      p_occurred_at: string;
    },
  ): Promise<{error: {message: string} | null}>;
};

/** Persists public consent evidence without accepting tenant or lead scope from browsers. */
export class SupabasePrivacyConsentRepository implements PrivacyConsentRepository {
  constructor(
    private readonly service: PrivacyConsentRpcClient = createServiceClient() as unknown as PrivacyConsentRpcClient,
  ) {}

  async record(input: PrivacyConsentEvidenceInput) {
    const {error} = await this.service.rpc("record_privacy_consent", {
      p_evidence_id: input.evidenceId,
      p_consent_id: input.consentId,
      p_company_id: null,
      p_lead_id: null,
      p_policy_version: input.policyVersion,
      p_analytics_granted: input.preferences.analytics,
      p_advertising_granted: input.preferences.advertising,
      p_gpc_detected: input.gpcDetected,
      p_source: input.source,
      p_request_ip: input.requestIp,
      p_user_agent: input.userAgent,
      p_occurred_at: input.occurredAt,
    });
    if (error) throw new Error("Failed to record privacy consent evidence");
  }
}
