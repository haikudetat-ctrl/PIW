import {NextResponse, type NextRequest} from "next/server";
import {
  AssessmentResultAccessError,
  markRoofAssessmentResultViewed,
  SupabaseAssessmentResultRepository,
  type AssessmentResultRepository,
} from "@/modules/roof-assessment/request-consultation";

const noStore = {"cache-control": "no-store"};

export async function handleResultViewRequest({token, repository}: {
  token: string;
  repository: AssessmentResultRepository;
}) {
  try {
    const result = await markRoofAssessmentResultViewed(token, repository);
    return NextResponse.json(result, {headers: noStore});
  } catch (error) {
    if (error instanceof AssessmentResultAccessError) {
      return NextResponse.json({error: error.message}, {status: error.status, headers: noStore});
    }
    return NextResponse.json({error: "Assessment result is temporarily unavailable"}, {status: 503, headers: noStore});
  }
}

type RouteContext = {params: Promise<{token: string}>};
export async function POST(_request: NextRequest, context: RouteContext) {
  const {token} = await context.params;
  return handleResultViewRequest({token, repository: new SupabaseAssessmentResultRepository()});
}
