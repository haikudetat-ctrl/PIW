import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  PublicAssessmentError,
  savePublicAssessmentOwnership,
  type PublicAssessmentOwnershipRepository,
} from "@/modules/roof-assessment/public-assessment";
import { SupabasePublicAssessmentRepository } from "@/modules/roof-assessment/supabase-public-assessment-repository";

export const runtime = "nodejs";

/**
 * "Do you own this home?" from the fast-booking gate, saved before the
 * calendar opens. The estimate token is the capability, as on the estimate page.
 */
export async function handleOwnershipRequest({
  token,
  body,
  repository,
}: {
  token: string;
  body: unknown;
  repository: PublicAssessmentOwnershipRepository;
}) {
  if (!z.uuid().safeParse(token).success) {
    return NextResponse.json({error: "Estimate not found"}, {status: 404});
  }
  try {
    return NextResponse.json(await savePublicAssessmentOwnership(token, body, repository));
  } catch (error) {
    if (error instanceof PublicAssessmentError) {
      return NextResponse.json(error.state ?? {error: error.message}, {status: error.status});
    }
    return NextResponse.json({error: "Roof assessment is temporarily unavailable"}, {status: 503});
  }
}

export async function POST(request: NextRequest, context: {params: Promise<{token: string}>}) {
  const {token} = await context.params;
  return handleOwnershipRequest({
    token,
    body: await request.json().catch(() => null),
    repository: new SupabasePublicAssessmentRepository(),
  });
}
