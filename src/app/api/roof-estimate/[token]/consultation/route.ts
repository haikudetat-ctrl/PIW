import {NextResponse, type NextRequest} from "next/server";
import {
  AssessmentResultAccessError,
  requestRoofConsultation,
  SupabaseAssessmentResultRepository,
  type AssessmentResultRepository,
} from "@/modules/roof-assessment/request-consultation";

const noStore = {"cache-control": "no-store"};

export async function handleConsultationRequest({token, body, repository}: {
  token: string;
  body: unknown;
  repository: AssessmentResultRepository;
}) {
  try {
    const summary = await requestRoofConsultation(token, body, repository);
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
  const body = await request.json().catch(() => null);
  return handleConsultationRequest({token, body, repository: new SupabaseAssessmentResultRepository()});
}
