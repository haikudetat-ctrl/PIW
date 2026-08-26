import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  completePublicAssessment,
  getPublicAssessment,
  PublicAssessmentError,
  savePublicAssessmentProgress,
  type PublicAssessmentRepository,
} from "@/modules/roof-assessment/public-assessment";
import { SupabasePublicAssessmentRepository } from "@/modules/roof-assessment/supabase-public-assessment-repository";

type AssessmentMethod = "GET" | "PATCH" | "POST";

export async function handlePublicAssessmentRequest({
  method,
  token,
  body,
  repository,
}: {
  method: AssessmentMethod;
  token: string;
  body?: unknown;
  repository: PublicAssessmentRepository;
}) {
  if (!z.uuid().safeParse(token).success) {
    return NextResponse.json({error: "Estimate not found"}, {status: 404});
  }

  try {
    const state = method === "GET"
      ? await getPublicAssessment(token, repository)
      : method === "PATCH"
        ? await savePublicAssessmentProgress(token, body, repository)
        : await completePublicAssessment(token, body, repository);
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof PublicAssessmentError) {
      return NextResponse.json(error.state ?? {error: error.message}, {status: error.status});
    }
    return NextResponse.json(
      {error: "Roof assessment is temporarily unavailable"},
      {status: 503},
    );
  }
}

type RouteContext = {params: Promise<{token: string}>};

async function handleRequest(request: NextRequest, context: RouteContext, method: AssessmentMethod) {
  const {token} = await context.params;
  const body = method === "GET" ? undefined : await request.json().catch(() => null);
  return handlePublicAssessmentRequest({
    method,
    token,
    body,
    repository: new SupabasePublicAssessmentRepository(),
  });
}

export function GET(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context, "GET");
}

export function PATCH(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context, "PATCH");
}

export function POST(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context, "POST");
}
