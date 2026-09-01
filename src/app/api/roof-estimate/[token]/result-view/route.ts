import {NextResponse, type NextRequest} from "next/server";
import {inngest} from "@/inngest/client";
import {parseServerEnv} from "@/lib/env/server";
import {createServiceClient} from "@/lib/supabase/service";
import {SupabaseMetaRepository, type ReservedMetaEvent} from "@/modules/marketing/meta-repository";
import {PRIVACY_COOKIE_NAME, verifyConsentCookie, type VerifiedConsent} from "@/modules/privacy/consent";
import {
  AssessmentResultAccessError,
  isTrustedCompletedQuote,
  markRoofAssessmentResultViewed,
  SupabaseAssessmentResultRepository,
  type AssessmentResultRepository,
} from "@/modules/roof-assessment/request-consultation";
import {trustedRequestIp} from "@/modules/roof-assessment/trusted-request-ip";

const noStore = {"cache-control": "no-store"};

type ResultViewDependencies = {
  token: string;
  repository: AssessmentResultRepository;
  metaTrackingEnabled?: boolean;
  consent?: VerifiedConsent | null;
  recordConsent?: (input: {
    leadId: string;
    companyId: string;
    consent: VerifiedConsent;
    occurredAt: string;
  }) => Promise<void>;
  reserveAssessment?: (input: {
    assessmentId: string;
    companyId: string;
    consentId: string;
    occurredAt: string;
  }) => Promise<ReservedMetaEvent | null>;
  requestDelivery?: (deliveryId: string) => Promise<void>;
  reportError?: (error: unknown) => void;
};

async function reserveAssessmentAfterAcknowledgement({
  acknowledgement,
  metaTrackingEnabled,
  consent,
  recordConsent,
  reserveAssessment,
  requestDelivery,
  reportError,
}: Omit<ResultViewDependencies, "token" | "repository"> & {
  acknowledgement: Awaited<ReturnType<typeof markRoofAssessmentResultViewed>>;
}) {
  if (
    !metaTrackingEnabled
    || !consent
    || !recordConsent
    || !reserveAssessment
    || !isTrustedCompletedQuote(acknowledgement.context)
  ) return null;

  try {
    const context = acknowledgement.context;
    await recordConsent({
      leadId: context.leadId!,
      companyId: context.companyId,
      consent,
      occurredAt: acknowledgement.resultViewedAt,
    });
    if (!consent.preferences.advertising) return null;

    const reserved = await reserveAssessment({
      assessmentId: context.assessmentId,
      companyId: context.companyId,
      consentId: consent.consentId,
      occurredAt: acknowledgement.resultViewedAt,
    });
    if (!reserved) return null;

    try {
      await requestDelivery?.(reserved.deliveryId);
    } catch (error) {
      (reportError ?? console.error)(error);
    }
    return reserved.envelope;
  } catch (error) {
    (reportError ?? console.error)(error);
    return null;
  }
}

export async function handleResultViewRequest({token, repository, ...dependencies}: ResultViewDependencies) {
  try {
    const acknowledgement = await markRoofAssessmentResultViewed(token, repository);
    const metaEvent = await reserveAssessmentAfterAcknowledgement({
      acknowledgement,
      ...dependencies,
    });
    return NextResponse.json({resultViewed: true, metaEvent}, {headers: noStore});
  } catch (error) {
    if (error instanceof AssessmentResultAccessError) {
      return NextResponse.json({error: error.message}, {status: error.status, headers: noStore});
    }
    return NextResponse.json({error: "Assessment result is temporarily unavailable"}, {status: 503, headers: noStore});
  }
}

function readConsentCookie(request: NextRequest) {
  const nextCookies = (request as Partial<NextRequest>).cookies;
  if (nextCookies) return nextCookies.get(PRIVACY_COOKIE_NAME)?.value;
  const encodedName = `${PRIVACY_COOKIE_NAME}=`;
  return request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(encodedName))?.slice(encodedName.length);
}

type RouteContext = {params: Promise<{token: string}>};
export async function POST(request: NextRequest, context: RouteContext) {
  const {token} = await context.params;
  const service = createServiceClient();
  const repository = new SupabaseAssessmentResultRepository(service);
  try {
    const environment = parseServerEnv(process.env);
    const consent = environment.META_TRACKING_ENABLED
      ? verifyConsentCookie(
        readConsentCookie(request),
        environment.PRIVACY_CONSENT_SIGNING_SECRET ?? "",
      )
      : null;
    const metaRepository = new SupabaseMetaRepository(service as never);
    return handleResultViewRequest({
      token,
      repository,
      metaTrackingEnabled: environment.META_TRACKING_ENABLED,
      consent,
      recordConsent: async ({leadId, companyId, consent: currentConsent, occurredAt}) => {
        const {error} = await service.rpc("record_privacy_consent", {
          p_evidence_id: crypto.randomUUID(),
          p_consent_id: currentConsent.consentId,
          p_company_id: companyId,
          p_lead_id: leadId,
          p_policy_version: currentConsent.policyVersion,
          p_analytics_granted: currentConsent.preferences.analytics,
          p_advertising_granted: currentConsent.preferences.advertising,
          p_gpc_detected: currentConsent.gpcDetected,
          p_source: currentConsent.gpcDetected ? "gpc" : "preferences",
          p_request_ip: trustedRequestIp(request.headers, environment.DEPLOYMENT_ENV),
          p_user_agent: request.headers.get("user-agent") ?? "",
          p_occurred_at: occurredAt,
        });
        if (error) throw new Error("Failed to record privacy consent evidence");
      },
      reserveAssessment: (input) => metaRepository.reserveAssessment(input),
      requestDelivery: async (deliveryId) => {
        await inngest.send({
          name: "marketing/meta.delivery.requested",
          data: {deliveryId},
        });
      },
    });
  } catch {
    // Tracking configuration cannot make an already-rendered quote unavailable.
    return handleResultViewRequest({token, repository});
  }
}
