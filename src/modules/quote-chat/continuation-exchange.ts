import "server-only";
import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {
  ASSESSMENT_SESSION_COOKIE,
  applyContinuationSession,
  resolveContinuation,
  type ContinuationSessionDependencies,
} from "@/modules/roof-assessment/continuation-session";

const CONTINUATION_PREFIX = "/roof-estimate/continue/";
const PLACEHOLDER_ORIGIN = "https://continuation.invalid";

const bodySchema = z.strictObject({path: z.string().min(1).max(4096)});
const noStore = {"cache-control": "no-store"};

/** Splits the intake's continuation path into its capability and optional consent handoff. */
export function parseContinuationPath(path: string): {continuation: string; privacyHandoff: string | null} | null {
  if (!path.startsWith(CONTINUATION_PREFIX)) return null;
  let url: URL;
  try {
    url = new URL(path, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  const segment = url.pathname.slice(CONTINUATION_PREFIX.length);
  if (!segment || segment.includes("/")) return null;
  try {
    return {continuation: decodeURIComponent(segment), privacyHandoff: url.searchParams.get("privacy_handoff")};
  } catch {
    return null;
  }
}

/**
 * The quote chat's version of following the continuation redirect: the same
 * capability check and cookies, answered with the estimate token as JSON so
 * the price can appear in the conversation instead of on a new page.
 */
export async function handleContinuationExchange(request: NextRequest, dependencies: ContinuationSessionDependencies) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  const target = body.success ? parseContinuationPath(body.data.path) : null;
  if (!target) return NextResponse.json({error: "Not found"}, {status: 404, headers: noStore});

  const outcome = await resolveContinuation(
    target.continuation,
    request.cookies.get(ASSESSMENT_SESSION_COOKIE)?.value,
    dependencies,
  );
  if (outcome.kind === "invalid") return NextResponse.json({error: "Not found"}, {status: 404, headers: noStore});
  // Another browser already opened this estimate; the chat points to the text and email instead.
  if (outcome.kind === "resume") return NextResponse.json({error: "Verification required", code: "verify"}, {status: 409, headers: noStore});

  const response = NextResponse.json({estimateToken: outcome.publicToken}, {headers: noStore});
  await applyContinuationSession(response, {
    assessmentId: outcome.assessmentId,
    continuation: target.continuation,
    privacyHandoff: target.privacyHandoff,
    transferPrivacy: outcome.firstVisit,
    now: dependencies.now(),
  }, dependencies);
  return response;
}
