import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {parseServerEnv} from "@/lib/env/server";
import {createServiceClient} from "@/lib/supabase/service";
import {
  assessmentAnalysisOutcomes,
  buildAssessmentAnalysisLog,
  resolveAssessmentJourneyScope,
  SupabaseAssessmentJourneyScopeRepository,
} from "@/modules/roof-assessment/analysis-telemetry";

const bodySchema = z.object({
  durationMs: z.number().int().min(0).max(13_000),
  outcome: z.enum(assessmentAnalysisOutcomes),
}).strict();

export async function POST(
  request: NextRequest,
  {params}: {params: Promise<{token: string}>},
) {
  const {token} = await params;
  if (!z.uuid().safeParse(token).success) {
    return NextResponse.json({error: "Estimate not found"}, {status: 404});
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid analysis event"}, {status: 400});
  }
  const environment = parseServerEnv(process.env);
  if (!environment.ROOF_ASSESSMENT_SIGNING_SECRET) {
    return NextResponse.json({error: "Estimate not found"}, {status: 404});
  }
  const scope = await resolveAssessmentJourneyScope(
    token,
    new SupabaseAssessmentJourneyScopeRepository(createServiceClient()),
    environment.ROOF_ASSESSMENT_SIGNING_SECRET,
  );
  if (!scope) {
    return NextResponse.json({error: "Estimate not found"}, {status: 404});
  }
  console.log(JSON.stringify(buildAssessmentAnalysisLog({
    correlation: scope.correlation,
    ...parsed.data,
  })));
  return new NextResponse(null, {status: 204, headers: {"cache-control": "no-store"}});
}
