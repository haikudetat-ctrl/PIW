import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {inngest} from "@/inngest/client";
import {parseServerEnv, resolveMetaTrackingConfiguration} from "@/lib/env/server";
import {createServiceClient} from "@/lib/supabase/service";
import {PRIVACY_COOKIE_NAME, type VerifiedConsent} from "@/modules/privacy/consent";
import {
  requestHasGlobalPrivacyControl,
  resolveCurrentVerifiedConsent,
} from "@/modules/privacy/current-consent";
import {SupabasePrivacyConsentRepository} from "@/modules/privacy/consent-repository";
import {
  AssessmentResultAccessError,
  markRoofAssessmentResultViewed,
  SupabaseAssessmentResultRepository,
  type AssessmentResultRepository,
} from "@/modules/roof-assessment/request-consultation";
import {trustedRequestIp} from "@/modules/roof-assessment/trusted-request-ip";

const noStore = {"cache-control": "no-store"};
const resultViewAcknowledgementSchema = z.object({
  renderedReadyPackageQuote: z.literal(true),
}).strict();

type ResultViewDependencies = {
  token: string;
  repository: AssessmentResultRepository;
  renderedReadyPackageQuote: boolean;
  metaTrackingEnabled?: boolean;
  consent?: VerifiedConsent | null;
  resolveConsent?: () => Promise<VerifiedConsent | null>;
  requestIp: string | null;
  userAgent: string;
  requestDelivery?: (deliveryId: string) => Promise<void>;
  reportError?: (error: unknown) => void;
};

export async function handleResultViewRequest({token, repository, ...dependencies}: ResultViewDependencies) {
  if (!dependencies.renderedReadyPackageQuote) {
    return NextResponse.json({error: "Ready quote acknowledgement required"}, {status: 400, headers: noStore});
  }
  if (!dependencies.requestIp) {
    return NextResponse.json({error: "Assessment result is temporarily unavailable"}, {status: 503, headers: noStore});
  }
  try {
    const allowed = await repository.consumeResultViewLimit(token, dependencies.requestIp);
    if (!allowed) {
      return NextResponse.json({error: "Request limit reached. Please try again later."}, {status: 429, headers: noStore});
    }
    let consent = dependencies.consent ?? null;
    if (dependencies.metaTrackingEnabled && dependencies.resolveConsent) {
      try {
        consent = await dependencies.resolveConsent();
      } catch (error) {
        // Tracking data may be unavailable without making the completed quote
        // or its durable first-view acknowledgement unavailable.
        (dependencies.reportError ?? console.error)(error);
        consent = null;
      }
    }
    const acknowledgement = await markRoofAssessmentResultViewed(token, {
      consent: dependencies.metaTrackingEnabled ? consent : null,
      requestIp: dependencies.requestIp,
      userAgent: dependencies.userAgent,
    }, repository);
    if (dependencies.metaTrackingEnabled && acknowledgement.metaDeliveryId) {
      try {
        await dependencies.requestDelivery?.(acknowledgement.metaDeliveryId);
      } catch (error) {
        (dependencies.reportError ?? console.error)(error);
      }
    }
    return NextResponse.json({
      resultViewed: true,
      metaEvent: dependencies.metaTrackingEnabled ? acknowledgement.metaEvent : null,
    }, {headers: noStore});
  } catch (error) {
    if (error instanceof AssessmentResultAccessError) {
      return NextResponse.json({error: error.message}, {status: error.status, headers: noStore});
    }
    return NextResponse.json({error: "Assessment result is temporarily unavailable"}, {status: 503, headers: noStore});
  }
}

function isSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
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
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({error: "Invalid request"}, {status: 403, headers: noStore});
  }
  const acknowledgement = resultViewAcknowledgementSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!acknowledgement.success) {
    return NextResponse.json({error: "Ready quote acknowledgement required"}, {status: 400, headers: noStore});
  }
  const service = createServiceClient();
  const repository = new SupabaseAssessmentResultRepository(service);
  try {
    const environment = parseServerEnv(process.env);
    const tracking = resolveMetaTrackingConfiguration(environment);
    return handleResultViewRequest({
      token,
      repository,
      renderedReadyPackageQuote: acknowledgement.data.renderedReadyPackageQuote,
      metaTrackingEnabled: Boolean(tracking),
      requestIp: trustedRequestIp(request.headers, environment.DEPLOYMENT_ENV),
      userAgent: request.headers.get("user-agent") ?? "",
      resolveConsent: async () => resolveCurrentVerifiedConsent({
        consentToken: readConsentCookie(request),
        signingSecret: tracking ? environment.PRIVACY_CONSENT_SIGNING_SECRET ?? "" : "",
        gpcDetected: requestHasGlobalPrivacyControl(request.headers),
        now: () => new Date(),
        repository: new SupabasePrivacyConsentRepository(service as never),
      }),
      requestDelivery: async (deliveryId) => {
        await inngest.send({
          name: "marketing/meta.delivery.requested",
          data: {deliveryId},
        });
      },
    });
  } catch {
    return NextResponse.json({error: "Assessment result is temporarily unavailable"}, {status: 503, headers: noStore});
  }
}
