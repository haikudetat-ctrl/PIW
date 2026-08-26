import {NextResponse, type NextRequest} from "next/server";
import {parseServerEnv} from "@/lib/env/server";
import {
  AssessmentResultAccessError,
  requestRoofConsultation,
  SupabaseAssessmentResultRepository,
  type AssessmentResultRepository,
} from "@/modules/roof-assessment/request-consultation";
import {trustedRequestIp} from "@/modules/roof-assessment/trusted-request-ip";

const noStore = {"cache-control": "no-store"};

export async function handleConsultationRequest({token, body, requestIp, repository}: {
  token: string;
  body: unknown;
  requestIp: string;
  repository: AssessmentResultRepository;
}) {
  try {
    const summary = await requestRoofConsultation(token, body, requestIp, repository);
    return NextResponse.json(summary, {headers: noStore});
  } catch (error) {
    if (error instanceof AssessmentResultAccessError) {
      return NextResponse.json({error: error.message}, {status: error.status, headers: noStore});
    }
    return NextResponse.json({error: "Assessment result is temporarily unavailable"}, {status: 503, headers: noStore});
  }
}

type RouteContext = {params: Promise<{token: string}>};
export async function POST(request: NextRequest, context: RouteContext) {
  const {token} = await context.params;
  const requestIp = trustedRequestIp(request.headers, parseServerEnv(process.env).DEPLOYMENT_ENV);
  if (!requestIp) return NextResponse.json({error: "Invalid request"}, {status: 400, headers: noStore});
  const body = await request.json().catch(() => null);
  return handleConsultationRequest({token, body, requestIp, repository: new SupabaseAssessmentResultRepository()});
}
